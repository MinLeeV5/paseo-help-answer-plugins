import { afterEach, describe, expect, it, vi } from "vitest";
import type { PaseoApi } from "@getpaseo/client";
import { SuggestionGenerator } from "../server/generator";
import { preferences, GENERATOR_LABEL, GENERATOR_VALUE, GENERATOR_TITLE } from "../shared/contracts";
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
  const refWorkspace = vi.fn((_id: string) => ({
    id: "source", agents: { create: createAgent }, archive: archivedWorkspace,
  }));
  const target = { id: "a", workspaceId: "source" as string | null, cwd: "/source", provider: "codex", model: "gpt-5.4-mini",
    labels: {}, title: "当前任务", status: "idle", pendingPermissions: [], archivedAt: null };
  const timeline = vi.fn(async () => ({ epoch: "e", hasOlder: false, entries: [
    { seqEnd: 1, item: { type: "user_message", text: "设计插件" } },
    { seqEnd: 2, item: { type: "assistant_message", text: "先做桌面版。" } },
  ] }));
  const api = {
    agents: { ref: () => ({ refresh: async () => ({ agent: target }), timeline: { refetch: timeline } }) },
    workspaces: { create: createWorkspace, ref: refWorkspace },
    config: { get: async () => ({ config: { metadataGeneration: { providers: [{ provider: "codex", model: "gpt-5.4-mini" }] } } }) },
    providers: { waitForReady: async () => ({ entries: [
      { provider: "codex", enabled: true, models: [{ id: "gpt-5.4-mini", label: "Mini" }] },
    ] }) },
  } as unknown as PaseoApi;
  return { api, target, timeline, wait, createAgent, createWorkspace, refWorkspace, archivedAgent, archivedController, archivedWorkspace };
}
const generators: SuggestionGenerator[] = [];
function generator() {
  const value = new SuggestionGenerator({ settings: async () => settings });
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

describe("generation in the conversation workspace", () => {
  it("reuses the source workspace, returns validated replies, and archives only its helper agents", async () => {
    const f = fixture(), service = generator();
    const result = await service.generate(f.api, "a");
    expect(result.phase).toBe("ready");
    expect(result.suggestions[0].text).toBe("先细化交互。");
    expect(f.refWorkspace).toHaveBeenCalledExactlyOnceWith("source");
    expect(f.createWorkspace).not.toHaveBeenCalled();
    const controller = f.createAgent.mock.calls[0][0] as Record<string, unknown>;
    expect(controller).not.toHaveProperty("prompt");
    expect(controller).not.toHaveProperty("parent");
    expect(controller).not.toHaveProperty("background");
    const options = f.createAgent.mock.calls[1][0] as Record<string, unknown>;
    expect(options.parent).toBe("controller");
    expect(options.parent).not.toBe(f.target.id);
    expect(options).not.toHaveProperty("callerAgentId");
    expect(options).not.toHaveProperty("background");
    expect(options.labels).toEqual({ [GENERATOR_LABEL]: GENERATOR_VALUE, "help-answer.source-agent-id": "a" });
    expect(f.archivedAgent).toHaveBeenCalledOnce();
    expect(f.archivedController).toHaveBeenCalledOnce();
    expect(f.archivedWorkspace).not.toHaveBeenCalled();
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
    expect(f.archivedController).toHaveBeenCalledOnce();
    expect(f.archivedWorkspace).not.toHaveBeenCalled();
  });
  it("archives a late helper after cancellation without touching the source workspace", async () => {
    const f = fixture(), service = generator(), delayed = deferred<Awaited<ReturnType<typeof f.createAgent>>>();
    const create = f.createAgent.getMockImplementation()!;
    f.createAgent.mockImplementationOnce(create).mockImplementationOnce(() => delayed.promise);
    const job = service.generate(f.api, "a");
    await vi.waitFor(() => expect(f.createAgent).toHaveBeenCalledTimes(2));
    service.invalidate("a");
    await job;
    delayed.resolve({ id: "late-helper", waitForFinish: f.wait, archive: f.archivedAgent });
    await vi.waitFor(() => expect(f.archivedAgent).toHaveBeenCalledOnce());
    expect(f.archivedController).toHaveBeenCalledOnce();
    expect(f.archivedWorkspace).not.toHaveBeenCalled();
    expect(f.createWorkspace).not.toHaveBeenCalled();
    expect(f.wait).not.toHaveBeenCalled();
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
    expect(f.archivedWorkspace).not.toHaveBeenCalled();
  });
  it("ignores labeled helpers even after they are renamed", async () => {
    const f = fixture(), service = generator();
    f.target.labels = { [GENERATOR_LABEL]: GENERATOR_VALUE };
    expect((await service.generate(f.api, "a")).phase).toBe("idle");
    expect(f.createWorkspace).not.toHaveBeenCalled();
    expect(f.createAgent).not.toHaveBeenCalled();
  });
  it("does not confuse other conversations in the same workspace with helper agents", async () => {
    const f = fixture(), service = generator(), pending = deferred<{ status: string; lastMessage: string }>();
    f.wait.mockImplementationOnce(() => pending.promise);
    const job = service.generate(f.api, "a");
    await vi.waitFor(() => expect(f.wait).toHaveBeenCalledOnce());
    expect(service.isGenerator(f.target)).toBe(false);
    expect(service.isGenerator({ title: GENERATOR_TITLE })).toBe(true);
    expect(service.isGenerator({ title: GENERATOR_TITLE + "（后台服务）" })).toBe(true);
    const second = fixture();
    second.target.id = "b";
    expect((await service.generate(second.api, "b")).phase).toBe("ready");
    expect(second.refWorkspace).toHaveBeenCalledExactlyOnceWith("source");
    pending.resolve({ status: "idle", lastMessage: output });
    expect((await job).phase).toBe("ready");
    expect(f.archivedWorkspace).not.toHaveBeenCalled();
    expect(second.archivedWorkspace).not.toHaveBeenCalled();
  });
  it("skips conversations without a workspace instead of creating one", async () => {
    const f = fixture(), service = generator();
    f.target.workspaceId = null;
    expect((await service.generate(f.api, "a")).phase).toBe("idle");
    expect(f.refWorkspace).not.toHaveBeenCalled();
    expect(f.createWorkspace).not.toHaveBeenCalled();
    expect(f.createAgent).not.toHaveBeenCalled();
  });
  it("skips pending permissions", async () => {
    const f = fixture(), service = generator();
    f.target.pendingPermissions = [{}] as never[];
    expect((await service.generate(f.api, "a")).phase).toBe("idle");
    expect(f.createAgent).not.toHaveBeenCalled();
  });
  it("does not create a replacement workspace when the existing workspace is unavailable", async () => {
    const f = fixture(), service = generator();
    f.createAgent.mockRejectedValueOnce(new Error("Workspace is archived"));
    expect((await service.generate(f.api, "a")).phase).toBe("error");
    expect(f.createWorkspace).not.toHaveBeenCalled();
    expect(f.archivedWorkspace).not.toHaveBeenCalled();
  });
  it("archives helpers when the plugin stops, while preserving the user's workspace", async () => {
    const f = fixture(), service = generator(), pending = deferred<{ status: string; lastMessage: string }>();
    f.wait.mockImplementationOnce(() => pending.promise);
    const job = service.generate(f.api, "a");
    await vi.waitFor(() => expect(f.wait).toHaveBeenCalledOnce());
    await service.dispose();
    await job;
    expect(f.archivedAgent).toHaveBeenCalledOnce();
    expect(f.archivedController).toHaveBeenCalledOnce();
    expect(f.archivedWorkspace).not.toHaveBeenCalled();
    expect(service.read("a").phase).toBe("idle");
  });
  it("archives helpers on timeout and keeps the source workspace open", async () => {
    vi.useFakeTimers();
    const f = fixture(), service = generator(), pending = deferred<{ status: string; lastMessage: string }>();
    f.wait.mockImplementationOnce(() => pending.promise);
    const job = service.generate(f.api, "a");
    await vi.waitFor(() => expect(f.wait).toHaveBeenCalledOnce());
    await vi.advanceTimersByTimeAsync(settings.timeoutSeconds * 1000);
    const result = await job;
    expect(result.phase).toBe("error");
    expect(result.errorCode).toBe("timeout");
    expect(f.archivedAgent).toHaveBeenCalledOnce();
    expect(f.archivedController).toHaveBeenCalledOnce();
    expect(f.archivedWorkspace).not.toHaveBeenCalled();
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
    expect(f.archivedAgent).toHaveBeenCalledOnce();
    expect(f.archivedController).toHaveBeenCalledOnce();
    expect(f.archivedWorkspace).not.toHaveBeenCalled();
    expect((await service.generate(f.api, "a", true)).phase).toBe("ready");
  });
});
