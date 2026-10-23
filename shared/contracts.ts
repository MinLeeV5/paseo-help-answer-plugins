import { defineRpc, defineSettings } from "@getpaseo/plugin";
import { z } from "zod";
import { generationErrorCodes } from "./errors";

export const GENERATOR_LABEL = "help-answer.role";
export const GENERATOR_VALUE = "generator";
export const GENERATOR_TITLE = "回复建议生成";

export const preferences = defineSettings({
  id: "preferences",
  scope: "host",
  version: 2,
  migrate: (values, fromVersion) => {
    if (fromVersion !== 1) throw new Error("Unsupported settings version: " + fromVersion);
    return values;
  },
  schema: z.object({
    uiLanguage: z.enum(["auto", "zh-CN", "en"]).default("auto"),
    automatic: z.boolean().default(true),
    count: z.number().int().min(2).max(5).default(3),
    language: z.enum(["auto", "zh-CN", "en"]).default("auto"),
    modelOverride: z.string().trim().max(200).default(""),
    instructions: z.string().trim().max(2000).default(""),
    historyTurns: z.number().int().min(1).max(10).default(4),
    timeoutSeconds: z.number().int().min(10).max(25).default(25),
  }),
});
export type Preferences = z.output<typeof preferences.schema>;
export type UiLanguage = Preferences["uiLanguage"];

export function generationSettingsKey({ uiLanguage: _uiLanguage, ...generation }: Preferences): string {
  return JSON.stringify(generation);
}

export const suggestionSchema = z.object({
  id: z.string(),
  label: z.string().trim().min(1).max(30),
  text: z.string().trim().min(1).max(500),
});
export type Suggestion = z.infer<typeof suggestionSchema>;
export const anchorSchema = z.object({
  epoch: z.string(),
  seq: z.number(),
});
export type Anchor = z.infer<typeof anchorSchema>;
export const batchSchema = z.object({
  agentId: z.string(),
  phase: z.enum(["idle", "generating", "ready", "error"]),
  sourceKey: z.string(),
  anchor: anchorSchema.nullable(),
  suggestions: z.array(suggestionSchema).max(5),
  model: z.string().nullable(),
  generatedAt: z.number().nullable(),
  error: z.string().nullable(),
  errorCode: z.enum(generationErrorCodes).nullable().default(null),
});
export type SuggestionBatch = z.infer<typeof batchSchema>;

export function emptyBatch(agentId: string): SuggestionBatch {
  return { agentId, phase: "idle", sourceKey: "", anchor: null, suggestions: [],
    model: null, generatedAt: null, error: null, errorCode: null };
}

export const readSuggestions = defineRpc({
  name: "suggestions.read",
  input: z.object({ agentId: z.string().min(1) }),
  output: batchSchema,
});
export const generateSuggestions = defineRpc({
  name: "suggestions.generate",
  input: z.object({ agentId: z.string().min(1), force: z.boolean().default(false) }),
  output: batchSchema,
});
export const confirmSubmission = defineRpc({
  name: "suggestions.confirm-submission",
  input: z.object({ agentId: z.string().min(1), anchor: anchorSchema, text: z.string().max(100_000) }),
  output: z.object({ accepted: z.boolean() }),
});
