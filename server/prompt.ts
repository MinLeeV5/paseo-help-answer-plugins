import { z } from "zod";
import { createHash } from "node:crypto";
import type { ConversationContext } from "./context";
import type { Preferences, Suggestion } from "../shared/contracts";
import { renderPromptTemplate } from "../shared/prompt";
import { GenerationError } from "../shared/errors";

export const generatedSchema = z.object({
  suggestions: z.array(z.object({
    label: z.string().trim().min(1).max(30),
    text: z.string().trim().min(1).max(500),
  })).max(5),
});

export function outputSchema(count: number): Record<string, unknown> {
  return { type: "object", additionalProperties: false, required: ["suggestions"], properties: {
    suggestions: { type: "array", minItems: 0, maxItems: count, items: {
      type: "object", additionalProperties: false, required: ["label", "text"], properties: {
        label: { type: "string" }, text: { type: "string" },
      },
    } },
  } };
}

export function buildPrompt(context: ConversationContext, settings: Preferences, previous: readonly Suggestion[]): string {
  const language = settings.language === "auto" ? "Use the language of the latest USER message."
    : settings.language === "zh-CN" ? "Write in Simplified Chinese." : "Write in English.";
  return renderPromptTemplate({
    count: settings.count,
    languageInstruction: language,
    additionalInstructions: settings.instructions ? "Additional writing preferences: " + settings.instructions : "",
    previousReplies: previous.length ? "Offer different alternatives from: " + JSON.stringify(previous.map((item) => item.text)) : "",
    conversation: JSON.stringify(context.messages),
  });
}

export function parseSuggestions(text: string | null, sourceKey: string, count: number): Suggestion[] {
  if (!text) throw new GenerationError("emptyResponse", "模型没有返回候选回复，请重试。");
  const stripped = text.trim().replace(/^\x60\x60\x60(?:json)?\s*/i, "").replace(/\s*\x60\x60\x60$/, "");
  let value: z.infer<typeof generatedSchema>;
  try { value = generatedSchema.parse(JSON.parse(stripped)); }
  catch { throw new GenerationError("invalidResponse", "模型返回的候选格式无效，请重试。"); }
  const seen = new Set<string>();
  const output: Suggestion[] = [];
  for (const item of value.suggestions) {
    const normalized = item.text.normalize("NFKC").toLowerCase().replace(/[\s\p{P}]/gu, "");
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    const textKey = createHash("sha256").update(item.text).digest("hex").slice(0, 10);
    output.push({ ...item, id: sourceKey + ":" + output.length + ":" + textKey });
    if (output.length === count) break;
  }
  return output;
}
