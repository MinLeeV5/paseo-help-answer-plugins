import type { PaseoApi, PaseoAgentHandle } from "./types";
import {
  GENERATOR_LABEL, GENERATOR_VALUE, GENERATOR_TITLE,
  emptyBatch, type Preferences, type SuggestionBatch,
} from "../shared/contracts";
import { readContext } from "./context";
import { resolveModels, modelKey } from "./models";
import { buildPrompt, outputSchema, parseSuggestions } from "./prompt";
import { DEFAULT_SYSTEM_PROMPT } from "../shared/prompt";
import { GenerationError } from "../shared/errors";

interface Job { controller: AbortController; promise: Promise<SuggestionBatch> }
const abortReasons = new WeakMap<AbortSignal, Error>();
function cancel(controller: AbortController, reason: Error): void {
  abortReasons.set(controller.signal, reason); controller.abort();
}
function abortReason(signal: AbortSignal): Error {
  return abortReasons.get(signal) ?? new Error("生成已取消");
}
function checkSignal(signal: AbortSignal): void { if (signal.aborted) throw abortReason(signal); }
export interface GeneratorOptions {
  settings(): Promise<Preferences>;
  log?(message: string): void;
}

function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(abortReason(signal));
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(abortReason(signal));
    signal.addEventListener("abort", abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

export class SuggestionGenerator {
  private batches = new Map<string, SuggestionBatch>();
  private jobs = new Map<string, Job>();
  private allJobs = new Set<Job>();
  private disposed = false;
  private active = 0;
  private waiting = new Set<() => void>();
  constructor(private readonly options: GeneratorOptions) {}
  read(agentId: string): SuggestionBatch { return this.batches.get(agentId) ?? emptyBatch(agentId); }
  isGenerator(agent: { title?: string | null; labels?: Record<string, string> }): boolean {
    // Lifecycle hooks omit labels, so keep the helper titles as a fallback.
    // Sharing a workspace must never classify its ordinary agents as helpers.
    return agent.labels?.[GENERATOR_LABEL] === GENERATOR_VALUE || agent.title === GENERATOR_TITLE ||
      agent.title === GENERATOR_TITLE + "（后台服务）";
  }
  invalidate(agentId: string): void {
    const job = this.jobs.get(agentId);
    if (job) cancel(job.controller, new Error("对话已进入新一轮"));
    this.jobs.delete(agentId);
    this.batches.delete(agentId);
  }
  reset(): void {
    for (const id of new Set([...this.jobs.keys(), ...this.batches.keys()])) this.invalidate(id);
  }
  async generate(paseo: PaseoApi, agentId: string, force = false): Promise<SuggestionBatch> {
    if (this.disposed) return emptyBatch(agentId);
    const existing = this.jobs.get(agentId);
    if (existing && !force) return existing.promise;
    if (existing) this.invalidate(agentId);
    const controller = new AbortController();
    const job: Job = { controller, promise: Promise.resolve(emptyBatch(agentId)) };
    this.jobs.set(agentId, job);
    this.allJobs.add(job);
    this.batches.set(agentId, { ...this.read(agentId), phase: "generating", error: null, errorCode: null });
    job.promise = this.run(paseo, agentId, job, force).finally(() => {
      this.allJobs.delete(job);
      if (this.jobs.get(agentId) === job) this.jobs.delete(agentId);
    });
    return job.promise;
  }
  private async acquire(signal: AbortSignal): Promise<() => void> {
    while (this.active >= 2) {
      await abortable(new Promise<void>((resolve) => {
        const wake = () => { this.waiting.delete(wake); resolve(); };
        this.waiting.add(wake);
        signal.addEventListener("abort", wake, { once: true });
      }), signal);
    }
    checkSignal(signal);
    this.active++;
    return () => { this.active--; this.waiting.values().next().value?.(); };
  }
  private async run(paseo: PaseoApi, agentId: string, job: Job, force: boolean): Promise<SuggestionBatch> {
    let release: (() => void) | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let helper: PaseoAgentHandle | undefined;
    let controller: PaseoAgentHandle | undefined;
    const signal = job.controller.signal;
    const publish = (batch: SuggestionBatch) => {
      if (!this.disposed && this.jobs.get(agentId) === job && !signal.aborted) this.batches.set(agentId, batch);
      return batch;
    };
    try {
      const settings = await this.options.settings();
      timer = setTimeout(() => cancel(job.controller, new GenerationError("timeout", "生成超时，请重试或选择更快的元数据模型。")), settings.timeoutSeconds * 1000);
      release = await this.acquire(signal);
      const target = await abortable(paseo.agents.ref(agentId).refresh(), signal);
      const agent = target?.agent;
      if (!agent || !agent.workspaceId || agent.archivedAt || (agent.status !== "idle" && agent.status !== "closed") ||
          this.isGenerator(agent) || agent.pendingPermissions.length) return publish(emptyBatch(agentId));
      const context = await abortable(readContext(paseo, agentId, settings), signal);
      if (!context) return publish(emptyBatch(agentId));
      const previous = this.read(agentId);
      if (!force && previous.sourceKey === context.sourceKey && previous.generatedAt) {
        return publish({ ...previous, phase: "ready" });
      }
      publish({ ...emptyBatch(agentId), sourceKey: context.sourceKey, anchor: context.anchor, phase: "generating" });
      const candidates = await abortable(resolveModels(paseo, agent, settings), signal);
      // The workspace belongs to the user. Only helper agents are ours to archive.
      const workspace = paseo.workspaces.ref(agent.workspaceId);
      let lastError: unknown;
      for (const candidate of candidates) {
        checkSignal(signal);
        try {
          const remainingMs = Math.max(1000, settings.timeoutSeconds * 1000);
          // Public SDK creation does not expose the daemon's internal flag.
          // A no-prompt controller never runs a turn; its children use Paseo's
          // delegated-agent notification policy without parenting to the user.
          const controllerCreation = workspace.agents.create({
            config: { provider: modelKey(candidate), thinkingOptionId: candidate.thinkingOptionId,
              systemPrompt: DEFAULT_SYSTEM_PROMPT, mcpServers: {} },
            title: GENERATOR_TITLE + "（后台服务）",
            labels: { [GENERATOR_LABEL]: GENERATOR_VALUE, "help-answer.source-agent-id": agentId,
              "help-answer.controller": "true" },
          });
          void controllerCreation.then(async (created) => {
            if (signal.aborted) await created.archive().catch(() => undefined);
          }, () => undefined);
          controller = await abortable(controllerCreation, signal);
          const helperCreation = workspace.agents.create({
            config: { provider: modelKey(candidate), thinkingOptionId: candidate.thinkingOptionId,
              systemPrompt: DEFAULT_SYSTEM_PROMPT,
              mcpServers: {} },
            parent: controller.id,
            title: GENERATOR_TITLE,
            prompt: buildPrompt(context, settings, force ? previous.suggestions : []),
            outputSchema: outputSchema(settings.count),
            labels: { [GENERATOR_LABEL]: GENERATOR_VALUE, "help-answer.source-agent-id": agentId },
          });
          void helperCreation.then(async (created) => {
            if (signal.aborted) await created.archive().catch(() => undefined);
          }, () => undefined);
          helper = await abortable(helperCreation, signal);
          const result = await abortable(helper.waitForFinish(remainingMs), signal);
          if (result.status !== "idle") {
            if (result.error) throw new Error(result.error);
            throw new GenerationError("incomplete", "模型未完成生成");
          }
          const suggestions = parseSuggestions(result.lastMessage, context.sourceKey, settings.count);
          return publish({ agentId, phase: "ready", sourceKey: context.sourceKey, anchor: context.anchor,
            suggestions, model: modelKey(candidate), generatedAt: Date.now(), error: null, errorCode: null });
        } catch (error) {
          if (signal.aborted) throw abortReason(signal);
          lastError = error;
          this.options.log?.("元数据模型 " + modelKey(candidate) + " 未完成生成，尝试下一项。");
        } finally {
          if (helper) await helper.archive().catch(() => this.options.log?.("辅助任务归档失败。"));
          if (controller) await controller.archive().catch(() => this.options.log?.("后台服务归档失败。"));
          helper = undefined;
          controller = undefined;
        }
      }
      throw lastError ?? new GenerationError("noModel", "没有可用的元数据模型。");
    } catch (error) {
      if (this.disposed || this.jobs.get(agentId) !== job) return this.read(agentId);
      const failure = signal.aborted ? abortReason(signal)
        : error instanceof Error ? error : new GenerationError("failed", "生成失败，请重试。");
      const batch = { ...this.read(agentId), phase: "error" as const, error: failure.message,
        errorCode: failure instanceof GenerationError ? failure.code : null };
      // Timeout is user-visible, but a superseded job must never overwrite a newer result.
      if (!this.disposed && this.jobs.get(agentId) === job) this.batches.set(agentId, batch);
      return batch;
    } finally {
      if (timer) clearTimeout(timer);
      if (helper) await helper.archive().catch(() => undefined);
      if (controller) await controller.archive().catch(() => undefined);
      release?.();
    }
  }
  async dispose(): Promise<void> {
    this.disposed = true;
    for (const job of this.allJobs) cancel(job.controller, new Error("插件已停止"));
    await Promise.allSettled([...this.allJobs].map((job) => job.promise));
    this.jobs.clear(); this.batches.clear();
  }
}
