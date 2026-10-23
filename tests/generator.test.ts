import { afterEach, describe, expect, it, vi } from "vitest";
import type { PaseoApi } from "@getpaseo/client";
import { SuggestionGenerator } from "../server/generator";
import { preferences, GENERATOR_LABEL, GENERATOR_VALUE } from "../shared/contracts";
import contribute from "../index.server";
import type { PluginServerContext } from "@getpaseo/plugin/server";

const settings = preferences.schema.parse({});
const output = JSON.stringify({ suggestions: [{ label: "先看交互", text: "先细化交互。" }] });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
function fixture() {
  const archivedAgent = vi.fn(async () => ({})), archivedController = vi.fn(async () => ({})), archivedWorkspace = vi.fn(async () => ({}));
  const wait = vi.fn(async () => ({ status: "idle", lastMessage: output }));
  const createAgent = vi.fn(async (options: { prompt?: string }) => ({
    id: options.prompt ? "helper" : "controller", waitForFinish: wait,
    archive: options.prompt ? archivedAgent : archivedController,
  }));
  const createWorkspace = vi.fn(async (_options: unknown) => ({
    id: "background", agents: { create: createAgent }, archive: archivedWorkspace,
  }));
  const target = { id: "a", workspaceId: "source", cwd: "/source", provider: "codex", model: "gpt-5.4-mini",
    labels: {}, title: "当前任务", status: "idle", pendingPermissions: [], archivedAt: null };
  const timeline = vi.fn(async () => ({ epoch: "e", hasOlder: false, entries: [
    { seqEnd: 1, item: { type: "user_message", text: "设计插件" } },
    { seqEnd: 2, item: { type: "assistant_message", text: "先做桌面版。" } },
  ] }));
  const api = {
    agents: { ref: () => ({ refresh: async () => ({ agent: target }), timeline: { refetch: timeline } }) },
    workspaces: { create: createWorkspace },
    config: { get: async () => ({ config: { metadataGeneration: { providers: [{ provider: "codex", model: "gpt-5.4-mini" }] } } }) },
    providers: { waitForReady: async () => ({ entries: [
      { provider: "codex", enabled: true, models: [{ id: "gpt-5.4-mini", label: "Mini" }] },
    ] }) },
  } as unknown as PaseoApi;
  return { api, target, timeline, wait, createAgent, createWorkspace, archivedAgent, archivedController, archivedWorkspace };
}
const generators: SuggestionGenerator[] = [];
function generator() {
  const value = new SuggestionGenerator({ settings: async () => settings, directory: "/tmp/help-answer-unit-generator" });
  generators.push(value); return value;
}
afterEach(async () => {
  await Promise.all(generators.splice(0).map((value) => value.dispose()));
  vi.useRealTimers();
});

it("keeps cached suggestions on an interface-language save, and invalidates them on generation-setting changes", async () => {
  const f = fixture();
  const current = { status: "ready" as const, revision: "one", values: { ...settings } };
  const handlers = new Map<string, (...args: any[]) => any>();
  let changed!: (state: typeof current) => void;
  const server = {
    registerSettings: () => ({
      read: async () => current,
      subscribe: (listener: typeof changed) => { changed = listener; return () => {}; },
    }),
    handle: (contract: { name: string }, handler: (...args: any[]) => any) => handlers.set(contract.name, handler),
    on() {},
  } as unknown as PluginServerContext;
  const cleanup = contribute(server);
  try {
    await handlers.get("suggestions.generate")!({ agentId: "a", force: false }, { paseo: f.api });
    const before = handlers.get("suggestions.read")!({ agentId: "a" });
    expect(before.phase).toBe("ready");
    current.values = { ...current.values, uiLanguage: "en" }; current.revision = "two";
    await changed(current);
    expect(handlers.get("suggestions.read")!({ agentId: "a" })).toEqual(before);
    current.values = { ...current.values, count: 5 }; current.revision = "three";
    await changed(current);
    expect(handlers.get("suggestions.read")!({ agentId: "a" }).phase).toBe("idle");
  } finally { await cleanup(); }
});

describe("background generation lifecycle", () => {
  it("creates hidden standalone work, returns validated replies, and archives both resources", async () => {
    const f = fixture(), service = generator();
    const result = await service.generate(f.api, "a");
    expect(result.phase).toBe("ready");
    expect(result.suggestions[0].text).toBe("先细化交互。");
    expect(f.createWorkspace.mock.calls[0][0]).toMatchObject({ background: true });
    const controller = f.createAgent.mock.calls[0][0] as Record<string, unknown>;
    expect(controller).not.toHaveProperty("prompt");
    expect(controller).not.toHaveProperty("parent");
    const options = f.createAgent.mock.calls[1][0] as Record<string, unknown>;
    expect(options.parent).toBe("controller");
    expect(options.parent).not.toBe(f.target.id);
    expect(options).not.toHaveProperty("callerAgentId");
    expect(options.labels).toEqual({ [GENERATOR_LABEL]: GENERATOR_VALUE, "help-answer.source-agent-id": "a" });
    expect(f.archivedAgent).toHaveBeenCalledOnce();
    expect(f.archivedController).toHaveBeenCalledOnce();
    expect(f.archivedWorkspace).toHaveBeenCalledOnce();
  });
  it("shares in-flight generation and reuses a completed result for the same reply", async () => {
    const f = fixture(), service = generator();
    const [a, b] = await Promise.all([service.generate(f.api, "a"), service.generate(f.api, "a")]);
    expect(a.sourceKey).toBe(b.sourceKey);
    await service.generate(f.api, "a");
    expect(f.createAgent).toHaveBeenCalledTimes(2);
  });
  it("does not publish a late result after a new turn starts", async () => {
    const f = fixture(), service = generator(), pending = deferred<{ status: string; lastMessage: string }>();
    f.wait.mockImplementationOnce(() => pending.promise);
    const job = service.generate(f.api, "a");
    await vi.waitFor(() => expect(f.wait).toHaveBeenCalledOnce());
    service.invalidate("a");
    await job;
    pending.resolve({ status: "idle", lastMessage: output });
    await Promise.resolve();
    expect(service.read("a").phase).toBe("idle");
    expect(f.archivedAgent).toHaveBeenCalledOnce();
    expect(f.archivedWorkspace).toHaveBeenCalledOnce();
  });
  it("archives a background workspace even when its create response arrives after cancellation", async () => {
    const f = fixture(), service = generator(), delayed = deferred<Awaited<ReturnType<typeof f.createWorkspace>>>();
    f.createWorkspace.mockImplementationOnce(() => delayed.promise);
    const job = service.generate(f.api, "a");
    await vi.waitFor(() => expect(f.createWorkspace).toHaveBeenCalledOnce());
    service.invalidate("a");
    await job;
    delayed.resolve({ id: "late", agents: { create: f.createAgent }, archive: f.archivedWorkspace });
    await vi.waitFor(() => expect(f.archivedWorkspace).toHaveBeenCalledOnce());
    expect(f.createAgent).not.toHaveBeenCalled();
  });
  it("archives a late controller after cancellation and never starts its helper", async () => {
    const f = fixture(), service = generator(), delayed = deferred<Awaited<ReturnType<typeof f.createAgent>>>();
    f.createAgent.mockImplementationOnce(() => delayed.promise);
    const job = service.generate(f.api, "a");
    await vi.waitFor(() => expect(f.createAgent).toHaveBeenCalledOnce());
    service.invalidate("a");
    await job;
    delayed.resolve({ id: "late-controller", waitForFinish: f.wait, archive: f.archivedController });
    await vi.waitFor(() => expect(f.archivedController).toHaveBeenCalledOnce());
    expect(f.createAgent).toHaveBeenCalledOnce();
    expect(f.wait).not.toHaveBeenCalled();
  });
  it("ignores helper agents and permission requests", async () => {
    const f = fixture(), service = generator();
    f.target.labels = { [GENERATOR_LABEL]: GENERATOR_VALUE };
    expect((await service.generate(f.api, "a")).phase).toBe("idle");
    expect(f.createWorkspace).not.toHaveBeenCalled();
  });
  it("can manually generate from a closed conversation without resuming its agent", async () => {
    const f = fixture(), service = generator();
    f.target.status = "closed";
    expect((await service.generate(f.api, "a")).phase).toBe("ready");
    expect(f.createAgent).toHaveBeenCalledTimes(2);
  });
  it("keeps failures retryable and cleans up invalid model output", async () => {
    const f = fixture(), service = generator();
    f.wait.mockResolvedValueOnce({ status: "idle", lastMessage: "not JSON" });
    expect((await service.generate(f.api, "a")).phase).toBe("error");
    expect(f.archivedWorkspace).toHaveBeenCalledOnce();
    expect((await service.generate(f.api, "a", true)).phase).toBe("ready");
  });
});
