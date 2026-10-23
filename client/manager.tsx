import { useEffect, useLayoutEffect } from "react";
import { View } from "react-native";
import type { PaseoAgent, PaseoAgentListResult, OwnedSubscription } from "@getpaseo/client";
import type { PluginClientContext, PluginButtonRegistration, PluginButtonIconProps, PluginText } from "@getpaseo/plugin/client";
import { useSettings, useTranslation } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/ui";
import { preferences, readSuggestions, generateSuggestions, confirmSubmission,
  GENERATOR_LABEL, GENERATOR_VALUE, type Preferences, type Anchor, type UiLanguage } from "../shared/contracts";
import { ReplyStore } from "./store";
import { DesktopBridge, markerId } from "./web";
import { messages, messagesForLanguage } from "./i18n";
import { resolveUiLocale, translator, generationErrorText, type UiLocale, type MessageKey } from "./messages";

export class ReplyManager {
  readonly store = new ReplyStore();
  readonly bridge: DesktopBridge;
  private agents = new Map<string, PaseoAgent>();
  private pills = new Map<string, { registration: PluginButtonRegistration<PluginText>; label: string }>();
  private markers = new Map<string, string>();
  private observation: OwnedSubscription<PaseoAgentListResult> | undefined;
  private releaseListener: (() => void) | undefined;
  private timer: ReturnType<typeof setInterval> | undefined;
  private stopped = false;
  private polling = false;
  private requesting = new Set<string>();
  private revision = "";
  private uiLanguage: UiLanguage = "auto";
  private locale: UiLocale;
  private unsubscribeStore: () => void;
  private removeGenerateCommand: () => void;
  constructor(readonly client: PluginClientContext) {
    this.locale = resolveUiLocale("auto", client.i18n.locale);
    this.bridge = new DesktopBridge(this.store, {
      regenerate: (agentId) => { void this.generate(agentId, true); },
      settings: () => client.openSettings("preferences"),
      confirm: (agentId, anchor, text, canceled) => this.confirm(agentId, anchor, text, canceled),
    }, this.locale);
    this.unsubscribeStore = this.store.subscribe(() => this.updatePillLabels());
    this.removeGenerateCommand = client.addCommandCenterItem({
      id: "generate-replies", context: "agent", title: messages.message("generateSuggestionsCommand"),
      icon: "MessageCircle", keywords: ["reply", "suggestions", "回复", "建议"],
      onSelect: async ({ agent }) => {
        await this.generate(agent.id, true);
        const batch = this.store.get(agent.id).batch;
        if (batch.phase === "error") throw new Error(generationErrorText(batch, this.locale) ?? translator(this.locale)("errorGeneration"));
      },
    });
  }
  configure(values: Preferences, revision: string, paseoLocale: string): void {
    const locale = resolveUiLocale(values.uiLanguage, paseoLocale);
    if (this.locale !== locale || this.uiLanguage !== values.uiLanguage) {
      this.locale = locale; this.uiLanguage = values.uiLanguage;
      this.bridge.setLocale(locale); this.updatePillLabels();
    }
    if (this.revision === revision) return;
    this.revision = revision;
    void this.poll();
  }
  async start(): Promise<void> {
    try {
      const page = await this.client.paseo.agents.list({ page: { limit: 100 }, subscribe: {} });
      if (this.stopped) { await page.subscription.release(); return; }
      this.observation = page.subscription;
      const snapshot = (value: PaseoAgentListResult) => {
        const found = new Set<string>();
        for (const entry of value.entries) { found.add(entry.agent.id); this.upsert(entry.agent); }
        for (const id of this.agents.keys()) if (!found.has(id)) this.remove(id);
      };
      this.releaseListener = page.subscription.subscribe({
        snapshot,
        update: (message) => {
          if (message.type === "agent_update") {
            if (message.payload.kind === "upsert") this.upsert(message.payload.agent);
            else this.remove(message.payload.agentId);
          }
        },
        error: () => { /* The SDK restores the owned observation on reconnect. */ },
      });
      snapshot(page);
      this.timer = setInterval(() => void this.poll(), 1400);
      void this.poll();
    } catch (error) {
      console.error("[help-answer] 无法读取会话目录", error instanceof Error ? error.message : "连接失败");
    }
  }
  private upsert(agent: PaseoAgent): void {
    if (!agent.workspaceId || agent.archivedAt || agent.labels?.[GENERATOR_LABEL] === GENERATOR_VALUE) {
      this.remove(agent.id); return;
    }
    this.agents.set(agent.id, agent);
    this.store.busy(agent.id, agent.status !== "idle" && agent.status !== "closed");
    if (!this.pills.has(agent.id)) this.register(agent);
  }
  private register(agent: PaseoAgent): void {
    const manager = this, agentId = agent.id;
    function TargetIcon({ theme, host, size, color }: PluginButtonIconProps) {
      const settings = useSettings(preferences);
      const { locale } = useTranslation(messages);
      useLayoutEffect(() => {
        manager.markers.set(agentId, markerId(host.id, agentId));
        manager.syncTargets(); manager.bridge.setTheme(agentId, theme);
      }, [host.id, theme]);
      useEffect(() => {
        if (settings.status === "ready") manager.configure(settings.values, settings.revision, locale);
      }, [settings.status, settings.status === "ready" ? settings.revision : null, locale]);
      return <View testID={markerId(host.id, agentId)}><Icon name="MessageCircle" size={size} color={color} /></View>;
    }
    const registration = this.client.addComposerPill({
      id: "reply-suggestions", workspaceId: agent.workspaceId!, agentId,
      button: { title: messagesForLanguage(this.uiLanguage).message("title"),
        label: messagesForLanguage(this.uiLanguage).message("title"), icon: TargetIcon,
        behavior: { kind: "action", onPress: () => this.client.openSettings("preferences") } },
    });
    this.pills.set(agent.id, { registration, label: "" });
    this.updatePillLabels();
  }
  private syncTargets(): void {
    this.bridge.setTargets([...this.markers].map(([agentId, marker]) => ({ agentId, marker })));
  }
  private remove(agentId: string): void {
    this.pills.get(agentId)?.registration.remove();
    this.pills.delete(agentId); this.agents.delete(agentId); this.markers.delete(agentId);
    this.store.remove(agentId); this.syncTargets();
  }
  private updatePillLabels(): void {
    for (const [id, pill] of this.pills) {
      const view = this.store.get(id);
      const key: MessageKey = view.sending ? "sendingPill" : view.selected ? "selectedPill"
        : view.batch.phase === "generating" ? "generatingPill" : view.batch.suggestions.length ? "countPill" : "title";
      const signature = [this.uiLanguage, this.locale, key, view.batch.suggestions.length].join(":");
      if (signature !== pill.label) {
        const labels = messagesForLanguage(this.uiLanguage);
        pill.registration.update({ title: labels.message("title"), label: labels.message(key, { count: view.batch.suggestions.length }) });
        pill.label = signature;
      }
    }
  }
  private async poll(): Promise<void> {
    if (this.polling || this.stopped) return;
    this.polling = true;
    try {
      await Promise.allSettled(this.bridge.visibleAgentIds().map(async (agentId) => {
        const agent = this.agents.get(agentId);
        if (!agent || (agent.status !== "idle" && agent.status !== "closed") || this.requesting.has(agentId)) return;
        const batch = await this.client.rpc(readSuggestions, { agentId });
        if (this.stopped) return;
        this.store.receive(batch);
        // Only the daemon's completed-turn hook triggers automatic generation.
        // An idle snapshot alone cannot distinguish a completed turn from cancellation.
      }));
    } finally { this.polling = false; }
  }
  async generate(agentId: string, force: boolean): Promise<void> {
    if (this.stopped || this.requesting.has(agentId) || this.store.get(agentId).busy) return;
    this.requesting.add(agentId);
    const revision = this.revision;
    this.store.receive({ ...this.store.get(agentId).batch, phase: "generating", error: null, errorCode: null });
    try {
      const batch = await this.client.rpc(generateSuggestions, { agentId, force });
      const status = this.agents.get(agentId)?.status;
      if (!this.stopped && this.revision === revision && (status === "idle" || status === "closed")) this.store.receive(batch);
    } catch {
      if (!this.stopped && this.revision === revision) this.store.receive({ ...this.store.get(agentId).batch,
        phase: "error", error: translator(this.locale)("errorConnection"), errorCode: "connection" });
    } finally { this.requesting.delete(agentId); }
  }
  private async confirm(agentId: string, anchor: Anchor, text: string, canceled: () => boolean): Promise<boolean> {
    const deadline = Date.now() + 12_000;
    while (!this.stopped && !canceled() && Date.now() < deadline) {
      try {
        const result = await this.client.rpc(confirmSubmission, { agentId, anchor, text });
        if (result.accepted) return true;
      } catch { /* Keep the selected reply until a receipt or timeout. */ }
      await new Promise<void>((resolve) => setTimeout(resolve, 400));
    }
    return false;
  }
  async dispose(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.releaseListener?.(); this.unsubscribeStore(); this.removeGenerateCommand(); this.bridge.destroy();
    for (const { registration } of this.pills.values()) registration.remove();
    await this.observation?.release();
    this.pills.clear();
  }
}
