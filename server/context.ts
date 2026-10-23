import { createHash } from "node:crypto";
import type { PaseoApi } from "./types";
import type { Anchor, Preferences } from "../shared/contracts";

export interface Exchange { role: "user" | "assistant"; text: string }
export interface ConversationContext {
  messages: Exchange[];
  sourceKey: string;
  anchor: Anchor;
}

// Only public user/assistant text enters the model prompt. Tool results and reasoning do not.
export async function readContext(paseo: PaseoApi, agentId: string, settings: Preferences): Promise<ConversationContext | null> {
  const handle = paseo.agents.ref(agentId);
  const entries: Array<{ seq: number; item: unknown }> = [];
  let cursor: NonNullable<Parameters<typeof handle.timeline.refetch>[0]>["cursor"] = undefined;
  let epoch = "";
  for (let pageNo = 0; pageNo < 4; pageNo++) {
    const page = await handle.timeline.refetch({ direction: cursor ? "before" : "tail", limit: 100, projection: "projected", ...(cursor ? { cursor } : {}) });
    if (epoch && page.epoch !== epoch) return null;
    epoch = page.epoch;
    entries.unshift(...page.entries.map((entry) => ({ seq: entry.seqEnd, item: entry.item })));
    const users = entries.filter(({ item }) => isMessage(item) && item.type === "user_message").length;
    if (users >= settings.historyTurns || !page.hasOlder) break;
    cursor = page.startCursor ?? undefined;
    if (!cursor) break;
  }
  return contextFromEntries(entries, epoch, settings.historyTurns);
}

function isMessage(item: unknown): item is { type: "user_message" | "assistant_message"; text: string } {
  if (!item || typeof item !== "object") return false;
  const value = item as { type?: unknown; text?: unknown };
  return (value.type === "user_message" || value.type === "assistant_message") && typeof value.text === "string";
}

export function contextFromEntries(entries: readonly { seq: number; item: unknown }[], epoch: string, turns: number): ConversationContext | null {
  const sorted = [...entries].sort((a, b) => a.seq - b.seq);
  const messages = sorted.filter(({ item }) => isMessage(item)).map(({ item }) => {
    const message = item as { type: string; text: string };
    return { role: message.type === "user_message" ? "user" as const : "assistant" as const, text: message.text };
  });
  if (messages.at(-1)?.role !== "assistant") return null;
  let users = 0;
  let start = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user" && ++users === turns) { start = i; break; }
  }
  const recent = messages.slice(start);
  // Preserve the latest exchange, trimming the oldest material first.
  let remaining = 16_000;
  const bounded: Exchange[] = [];
  for (let i = recent.length - 1; i >= 0 && remaining > 0; i--) {
    const text = recent[i].text.slice(-remaining);
    remaining -= text.length;
    bounded.unshift({ role: recent[i].role, text });
  }
  const seq = sorted.at(-1)?.seq ?? 0;
  const sourceKey = createHash("sha256").update(JSON.stringify({ epoch, seq, messages: bounded })).digest("hex").slice(0, 24);
  return { messages: bounded, sourceKey, anchor: { epoch, seq } };
}

export async function wasSubmitted(paseo: PaseoApi, agentId: string, anchor: Anchor, text: string): Promise<boolean> {
  const page = await paseo.agents.ref(agentId).timeline.refetch({ direction: "tail", limit: 100, projection: "projected" });
  if (page.epoch !== anchor.epoch) return false;
  return page.entries.some(({ seqEnd, item }) =>
    seqEnd > anchor.seq && isMessage(item) && item.type === "user_message" && item.text.trim() === text.trim());
}
