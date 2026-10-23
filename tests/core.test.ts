import { describe, expect, it } from "vitest";
import { contextFromEntries } from "../server/context";
import { chooseModels } from "../server/models";
import { parseSuggestions, buildPrompt } from "../server/prompt";
import { preferences, emptyBatch, type SuggestionBatch } from "../shared/contracts";
import { ReplyStore, fillReply } from "../client/store";
import { DEFAULT_PROMPT_TEMPLATE, DEFAULT_SYSTEM_PROMPT } from "../shared/prompt";
import { chinese, english, generationErrorText, resolveUiLocale, translator } from "../client/messages";

const settings = preferences.schema.parse({});
const suggestion = { id: "one", label: "先看交互", text: "先把交互细化一下。" };
function batch(id = "a", key = "turn-1"): SuggestionBatch {
  return { ...emptyBatch(id), phase: "ready", sourceKey: key, anchor: { epoch: "e", seq: 8 },
    suggestions: [suggestion], generatedAt: 1 };
}

describe("prompt and language preferences", () => {
  it("migrates existing settings without changing reply language or custom instructions", async () => {
    const old = { ...settings, uiLanguage: undefined, language: "en", instructions: "Keep it concrete.", count: 5 };
    const migrated = preferences.schema.parse(await preferences.migrate!(old, 1));
    expect(migrated).toMatchObject({ uiLanguage: "auto", language: "en", instructions: old.instructions, count: 5 });
  });
  it("fills the displayed prompt template once and keeps user text and prompt defaults intact", () => {
    const context = contextFromEntries([
      { seq: 1, item: { type: "user_message", text: "Keep {{count}} as literal text." } },
      { seq: 2, item: { type: "assistant_message", text: "Which direction should we take?" } },
    ], "e", 1)!;
    const prompt = buildPrompt(context, { ...settings, count: 5, language: "en", uiLanguage: "zh-CN", instructions: "Be specific." }, []);
    expect(prompt).toContain("Offer up to 5 short");
    expect(prompt).toContain("Write in English.");
    expect(prompt).toContain("Additional writing preferences: Be specific.");
    expect(prompt).toContain(JSON.stringify(context.messages));
    expect(prompt).not.toContain("{{languageInstruction}}");
    expect(DEFAULT_PROMPT_TEMPLATE).toContain("{{count}}");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("Never use tools");
    expect(preferences.schema.parse({ defaultPrompt: "Override" })).not.toHaveProperty("defaultPrompt");
  });
  it("follows Paseo by default, supports region tags, and honors an explicit override", () => {
    expect(settings.uiLanguage).toBe("auto");
    expect(resolveUiLocale("auto", "en-US")).toBe("en");
    expect(resolveUiLocale("auto", "zh-CN")).toBe("zh-CN");
    expect(resolveUiLocale("auto", "zh-TW")).toBe("zh-CN");
    expect(resolveUiLocale("auto", "fr")).toBe("en");
    expect(resolveUiLocale("zh-CN", "en")).toBe("zh-CN");
    expect(resolveUiLocale("en", "zh-CN")).toBe("en");
    expect(translator("en")("countOption", { count: 3 })).toBe("3 suggestions");
    expect(translator("zh-CN")("followPaseo")).toBe("跟随 Paseo");
  });
  it("provides the same translation keys and interpolation names in both languages", () => {
    expect(Object.keys(chinese).sort()).toEqual(Object.keys(english).sort());
    for (const key of Object.keys(english) as Array<keyof typeof english>) {
      expect(chinese[key].match(/\{\{\w+\}\}/g) ?? []).toEqual(english[key].match(/\{\{\w+\}\}/g) ?? []);
    }
  });
  it("translates plugin errors while preserving original provider messages", () => {
    const failure = { error: "生成超时，请重试或选择更快的元数据模型。", errorCode: "timeout" as const };
    expect(generationErrorText(failure, "en")).toBe("Generation timed out. Try again or choose a faster metadata model.");
    expect(generationErrorText(failure, "zh-CN")).toBe(failure.error);
    expect(generationErrorText({ error: "Original provider error", errorCode: null }, "zh-CN")).toBe("Original provider error");
  });
});

describe("conversation context", () => {
  it("reads user/assistant text only and keeps recent exchanges in sequence", () => {
    const input = [
      { seq: 1, item: { type: "user_message", text: "旧问题" } },
      { seq: 2, item: { type: "assistant_message", text: "旧回答" } },
      { seq: 3, item: { type: "user_message", text: "最新问题" } },
      { seq: 4, item: { type: "reasoning", text: "私有思考" } },
      { seq: 5, item: { type: "tool_call", text: "工具输出" } },
      { seq: 6, item: { type: "assistant_message", text: "最新回答" } },
    ];
    const context = contextFromEntries(input, "epoch", 1)!;
    expect(context.messages).toEqual([{ role: "user", text: "最新问题" }, { role: "assistant", text: "最新回答" }]);
    expect(context.anchor).toEqual({ epoch: "epoch", seq: 6 });
    expect(contextFromEntries(input.slice(0, 3), "epoch", 1)).toBeNull();
    expect(contextFromEntries(input, "another-epoch", 1)?.sourceKey).not.toBe(context.sourceKey);
  });
  it("bounds model input while preserving the latest reply", () => {
    const context = contextFromEntries([
      { seq: 1, item: { type: "user_message", text: "x".repeat(30_000) } },
      { seq: 2, item: { type: "assistant_message", text: "最新回答" } },
    ], "e", 4)!;
    expect(context.messages.reduce((size, item) => size + item.text.length, 0)).toBeLessThanOrEqual(16_000);
    expect(context.messages.at(-1)?.text).toBe("最新回答");
    expect(buildPrompt(context, settings, [])).toContain("NEXT USER MESSAGES");
  });
});

describe("metadata model selection", () => {
  const entries = [
    { provider: "claude", enabled: true, status: "ready", models: [
      { provider: "claude", id: "haiku-v1", label: "Haiku", isDefault: true },
    ] },
    { provider: "codex", enabled: true, status: "ready", models: [
      { provider: "codex", id: "gpt-5.4-mini", label: "Mini", isDefault: true, thinkingOptions: [{ id: "low", label: "Low" }] },
      { provider: "codex", id: "big", label: "Big" },
    ] },
    { provider: "disabled", enabled: false, status: "ready", models: [
      { provider: "disabled", id: "haiku", label: "Haiku" },
    ] },
  ] as Parameters<typeof chooseModels>[0];
  it("uses the configured manual list without falling into other accounts", () => {
    expect(chooseModels(entries, [{ provider: "codex", model: "big" }], { provider: "claude" }, ""))
      .toEqual([{ provider: "codex", model: "big" }]);
  });
  it("resolves automatic small models and removes repeated current selections", () => {
    const models = chooseModels(entries, [], { provider: "codex", model: "gpt-5.4-mini" }, "");
    expect(models.map((model) => model.provider)).toEqual(["claude", "codex"]);
    expect(models[1].thinkingOptionId).toBe("low");
  });
  it("validates overrides and ignores disabled providers", () => {
    expect(chooseModels(entries, [], { provider: "claude" }, "codex/big")).toEqual([{ provider: "codex", model: "big" }]);
    expect(() => chooseModels(entries, [], { provider: "claude" }, "disabled/haiku")).toThrow("不可用");
  });
});

describe("model output", () => {
  it("deduplicates equivalent replies and accepts no useful follow-up", () => {
    const value = JSON.stringify({ suggestions: [
      { label: "继续", text: "先实现。" }, { label: "开始", text: "先 实现!" },
      { label: "解释", text: "先解释选择这个方案的原因。" },
    ] });
    expect(parseSuggestions(value, "key", 3)).toHaveLength(2);
    expect(parseSuggestions('{"suggestions":[]}', "key", 3)).toEqual([]);
  });
  it("rejects malformed or overlong replies instead of displaying them", () => {
    expect(() => parseSuggestions('{"suggestions":[{"label":"a","text":""}]}', "k", 3)).toThrow();
    expect(() => parseSuggestions("not JSON", "k", 3)).toThrow();
  });
  it("gives regenerated alternatives distinct identities without replacing an edited selection", () => {
    const first = parseSuggestions('{"suggestions":[{"label":"执行","text":"先实现。"}]}', "same-turn", 3);
    const next = parseSuggestions('{"suggestions":[{"label":"执行","text":"先写测试。"}]}', "same-turn", 3);
    expect(first[0].id).not.toBe(next[0].id);
  });
});

describe("reply draft isolation", () => {
  it("dismisses submitted suggestions and ignores stale polling results until a newer reply arrives", () => {
    const store = new ReplyStore(), previous = batch();
    store.receive(previous);
    expect(store.beginSend("a", true)).toBe(true);
    store.finishSend("a", true, null, previous);
    store.receive(previous);
    store.receive(emptyBatch("a"));
    expect(store.get("a").awaitingReply).toBe(true);
    expect(store.get("a").batch.suggestions).toEqual([]);
    store.receive({ ...previous, sourceKey: "older", anchor: { epoch: "e", seq: 4 } });
    expect(store.get("a").awaitingReply).toBe(true);
    store.receive({ ...batch("a", "new-reply"), anchor: { epoch: "e", seq: 12 } });
    expect(store.get("a").awaitingReply).toBe(false);
    expect(store.get("a").batch.sourceKey).toBe("new-reply");
    store.receive(previous);
    expect(store.get("a").batch.sourceKey).toBe("new-reply");
  });
  it("keeps a newer completed reply when the previous submission receipt is delayed", () => {
    const store = new ReplyStore(), previous = batch();
    store.receive(previous); store.choose("a", suggestion); store.beginSend("a");
    store.receive({ ...batch("a", "next-reply"), anchor: { epoch: "e", seq: 12 } });
    store.finishSend("a", true, null, previous);
    expect(store.get("a").awaitingReply).toBe(false);
    expect(store.get("a").batch.sourceKey).toBe("next-reply");
    expect(store.get("a").selected).toBeNull();
  });
  it("keeps suggestions usable after a failed ordinary send", () => {
    const store = new ReplyStore();
    store.receive(batch()); store.beginSend("a", true); store.finishSend("a", false, "Not accepted");
    expect(store.get("a").awaitingReply).toBe(false);
    store.choose("a", suggestion);
    expect(store.get("a").selected).toEqual(suggestion);
  });
  it("keeps choices isolated per agent and replaces the selected alternative", () => {
    const store = new ReplyStore();
    store.receive(batch()); store.choose("a", suggestion);
    store.choose("a", { ...suggestion, id: "two", text: "先解释。" });
    expect(store.get("a").selected?.text).toBe("先解释。");
    expect(store.get("b").selected).toBeNull();
    store.busy("a", true);
    expect(store.get("a").selected).toBeNull();
  });
  it("preserves selected text until submission is acknowledged, including failure", () => {
    const store = new ReplyStore();
    store.receive(batch()); store.choose("a", { ...suggestion, text: "先改好交互。" });
    expect(store.beginSend("a")).toBe(true);
    expect(store.beginSend("a")).toBe(false);
    store.receive(batch("a", "turn-2"));
    expect(store.get("a").selected?.text).toBe("先改好交互。");
    store.finishSend("a", false, "发送失败");
    expect(store.get("a").selected?.text).toBe("先改好交互。");
    store.finishSend("a", true);
    expect(store.get("a").selected).toBeNull();
  });
  it("fills a candidate while preserving the existing draft exactly", () => {
    expect(fillReply(" 保留现有功能。 ", "先细化。")).toBe("先细化。\n\n 保留现有功能。 ");
    expect(fillReply("", "先细化。")).toBe("先细化。");
  });
  it("replaces only an unchanged previous candidate and preserves user edits", () => {
    expect(fillReply("先细化。\n\n补充", "先实现。", "先细化。")).toBe("先实现。\n\n补充");
    expect(fillReply("先细化。", "先细化。", "先细化。")).toBe("先细化。");
    expect(fillReply("用户已改写。", "先实现。", "先细化。")).toBe("先实现。\n\n用户已改写。");
  });
});
