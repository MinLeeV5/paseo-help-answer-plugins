import type { PaseoApi, PaseoAgent, PaseoProviderSnapshotResult } from "@getpaseo/client";
import type { Preferences } from "../shared/contracts";
import { GenerationError } from "../shared/errors";

export interface ModelSelection {
  provider: string;
  model?: string;
  thinkingOptionId?: string;
}
type Entry = PaseoProviderSnapshotResult["entries"][number];
export const SMALL_MODELS = ["haiku", "gpt-5.4-mini", "minimax-m3", "nemotron-3-super"];

export function modelKey(model: ModelSelection): string {
  return model.provider + (model.model ? "/" + model.model : "");
}

export function chooseModels(
  entries: readonly Entry[],
  configured: readonly ModelSelection[],
  current: ModelSelection,
  override: string,
): ModelSelection[] {
  const enabled = entries.filter((entry) => entry.enabled);
  const candidates: ModelSelection[] = [];
  const resolve = (candidate: ModelSelection) => {
    const entry = enabled.find((item) => item.provider === candidate.provider);
    if (!entry) return;
    const model = candidate.model
      ? entry.models?.find((item) => item.id === candidate.model || item.label === candidate.model || item.aliases?.includes(candidate.model!))
      : entry.models?.find((item) => item.isDefault) ?? entry.models?.[0];
    if (candidate.model && !model) return;
    const thinking = model?.thinkingOptions?.some((item) => item.id === candidate.thinkingOptionId)
      ? candidate.thinkingOptionId : model?.defaultThinkingOptionId;
    candidates.push({ provider: entry.provider, ...(model ? { model: model.id } : {}),
      ...(thinking ? { thinkingOptionId: thinking } : {}) });
  };
  if (override.trim()) {
    const [provider, ...rest] = override.trim().split("/");
    resolve({ provider, ...(rest.length ? { model: rest.join("/") } : {}) });
    if (!candidates.length) throw new GenerationError("invalidModel", "指定的模型不可用，请检查 Provider 是否启用以及模型名称。");
  } else if (configured.length) {
    // Manual metadata configuration is authoritative; do not silently use another account/model.
    configured.forEach(resolve);
  } else {
    for (const needle of SMALL_MODELS) {
      for (const entry of enabled) {
        const model = entry.models?.find((item) => (item.id + " " + item.label).toLowerCase().includes(needle));
        if (model) { resolve({ provider: entry.provider, model: model.id,
          ...(needle === "gpt-5.4-mini" ? { thinkingOptionId: "low" } : {}) }); break; }
      }
    }
    resolve(current);
  }
  const first = new Map<string, ModelSelection>();
  for (const item of candidates) if (!first.has(modelKey(item))) first.set(modelKey(item), item);
  const unique = [...first.values()];
  if (!unique.length) throw new GenerationError("noModel", "没有可用的元数据模型。请在主机的元数据设置中选择模型。");
  return unique;
}

export async function resolveModels(paseo: PaseoApi, agent: PaseoAgent, settings: Preferences): Promise<ModelSelection[]> {
  const [{ config }, snapshot] = await Promise.all([
    paseo.config.get(),
    paseo.providers.waitForReady({ cwd: agent.cwd, timeoutMs: 8000 }),
  ]);
  return chooseModels(snapshot.entries, config.metadataGeneration?.providers ?? [], {
    provider: agent.provider, ...(agent.model ? { model: agent.model } : {}),
    ...(agent.thinkingOptionId ? { thinkingOptionId: agent.thinkingOptionId } : {}),
  }, settings.modelOverride);
}
