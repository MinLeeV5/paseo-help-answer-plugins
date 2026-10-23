import type { PluginServerContext } from "@getpaseo/plugin/server";
import { SuggestionGenerator } from "./server/generator";
import { wasSubmitted } from "./server/context";
import { preferences, readSuggestions, generateSuggestions, confirmSubmission, generationSettingsKey } from "./shared/contracts";
import { GenerationError } from "./shared/errors";

export default function contribute(server: PluginServerContext) {
  const settings = server.registerSettings(preferences);
  let generationKey: string | undefined;
  const generator = new SuggestionGenerator({
    async settings() {
      const current = await settings.read();
      if (current.status !== "ready") throw new GenerationError("settings", "回复建议的设置无效，请在插件设置中恢复默认值。");
      generationKey ??= generationSettingsKey(current.values);
      return current.values;
    },
    log(message) { console.log("[help-answer] " + message); },
  });
  const stopSettings = settings.subscribe((current) => {
    const nextKey = current.status === "ready" ? generationSettingsKey(current.values) : "invalid";
    if (generationKey !== undefined && generationKey !== nextKey) generator.reset();
    generationKey = nextKey;
  });
  server.handle(readSuggestions, ({ agentId }) => generator.read(agentId));
  server.handle(generateSuggestions, ({ agentId, force }, { paseo }) => generator.generate(paseo, agentId, force));
  server.handle(confirmSubmission, async ({ agentId, anchor, text }, { paseo }) =>
    ({ accepted: await wasSubmitted(paseo, agentId, anchor, text) }));
  server.on("agent.turn_started", ({ agent }) => {
    if (!generator.isGenerator(agent)) generator.invalidate(agent.id);
  });
  server.on("agent.turn_ended", async ({ agent, outcome }, { paseo }) => {
    if (outcome.kind !== "completed" || generator.isGenerator(agent)) return;
    const current = await settings.read();
    if (current.status === "ready" && current.values.automatic) await generator.generate(paseo, agent.id);
  });
  server.on("agent.archived", ({ agent }) => generator.invalidate(agent.id));
  return () => { stopSettings(); return generator.dispose(); };
}
