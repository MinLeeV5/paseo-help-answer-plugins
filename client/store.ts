import { emptyBatch, type SuggestionBatch, type Suggestion, type Anchor } from "../shared/contracts";

type SubmittedSource = { sourceKey: string; anchor: Anchor | null };

export interface ReplyView {
  batch: SuggestionBatch;
  selected: Suggestion | null;
  sending: boolean;
  busy: boolean;
  error: string | null;
  awaitingReply: boolean;
  submitted: SubmittedSource | null;
}

export class ReplyStore {
  private views = new Map<string, ReplyView>();
  private listeners = new Set<() => void>();
  get(agentId: string): ReplyView {
    let view = this.views.get(agentId);
    if (!view) {
      view = { batch: emptyBatch(agentId), selected: null, sending: false, busy: false, error: null,
        awaitingReply: false, submitted: null };
      this.views.set(agentId, view);
    }
    return view;
  }
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  private patch(agentId: string, patch: Partial<ReplyView>): void {
    this.views.set(agentId, { ...this.get(agentId), ...patch });
    for (const listener of this.listeners) listener();
  }
  receive(batch: SuggestionBatch): void {
    const view = this.get(batch.agentId);
    if (view.submitted && batch.sourceKey && (batch.sourceKey === view.submitted.sourceKey ||
        batch.anchor && view.submitted.anchor && batch.anchor.epoch === view.submitted.anchor.epoch &&
        batch.anchor.seq <= view.submitted.anchor.seq)) return;
    if (view.awaitingReply && !batch.sourceKey) return;
    if (JSON.stringify(view.batch) === JSON.stringify(batch)) return;
    const changed = view.batch.sourceKey !== batch.sourceKey;
    this.patch(batch.agentId, { batch, awaitingReply: false, ...(changed && !view.sending ? { selected: null } : {}) });
  }
  choose(agentId: string, suggestion: Suggestion): void {
    const view = this.get(agentId);
    if (view.sending || view.busy || view.awaitingReply) return;
    this.patch(agentId, { selected: { ...suggestion }, error: null });
  }
  clear(agentId: string): void {
    if (!this.get(agentId).sending) this.patch(agentId, { selected: null, error: null });
  }
  busy(agentId: string, busy: boolean): void {
    const view = this.get(agentId);
    if (view.busy === busy) return;
    this.patch(agentId, { busy, ...(busy && !view.sending ? { selected: null, batch: emptyBatch(agentId),
      awaitingReply: true, submitted: view.batch.sourceKey
        ? { sourceKey: view.batch.sourceKey, anchor: view.batch.anchor } : view.submitted } : {}) });
  }
  beginSend(agentId: string, hasNativeDraft = false): boolean {
    const view = this.get(agentId);
    if ((!view.selected?.text.trim() && !hasNativeDraft) || view.sending || view.busy || view.awaitingReply) return false;
    this.patch(agentId, { sending: true, error: null });
    return true;
  }
  finishSend(agentId: string, accepted: boolean, error: string | null = null, source?: SubmittedSource): void {
    const view = this.get(agentId);
    const submitted = source ?? { sourceKey: view.batch.sourceKey, anchor: view.batch.anchor };
    // A fresh reply can arrive before a delayed submission receipt. Keep that newer batch.
    const fresh = accepted && view.batch.sourceKey && view.batch.sourceKey !== submitted.sourceKey &&
      view.batch.anchor && submitted.anchor && (view.batch.anchor.epoch !== submitted.anchor.epoch ||
        view.batch.anchor.seq > submitted.anchor.seq);
    this.patch(agentId, { sending: false, error, ...(accepted ? { selected: null, submitted,
      awaitingReply: !fresh, ...(!fresh ? { batch: emptyBatch(agentId) } : {}) } : {}) });
  }
  error(agentId: string, error: string): void { this.patch(agentId, { error }); }
  remove(agentId: string): void { this.views.delete(agentId); }
}

export function fillReply(draft: string, reply: string, previous?: string): string {
  if (previous && draft.startsWith(previous)) return reply + draft.slice(previous.length);
  return draft.trim() ? reply + "\n\n" + draft : reply;
}
