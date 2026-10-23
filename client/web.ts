import type { PluginTheme } from "@getpaseo/plugin";
import type { Anchor, Suggestion } from "../shared/contracts";
import { ReplyStore, fillReply } from "./store";
import { translator, generationErrorText, type UiLocale } from "./messages";

// All DOM dependencies live here. Host selectors verified on Paseo 0.13.0-beta.1.
// Our SDK pill supplies agent identity: no React internals or active-tab guesses.
const ROOT = '[data-testid="message-input-root"]';
const INPUT = 'textarea[data-composer-input]';
export function markerId(hostId: string, agentId: string): string {
  return "help-answer-target:" + hostId + ":" + agentId;
}
export interface DesktopTarget { agentId: string; marker: string }
export interface DesktopActions {
  regenerate(agentId: string): void;
  settings(): void;
  confirm(agentId: string, anchor: Anchor, text: string, canceled: () => boolean): Promise<boolean>;
}
interface DomEvent {
  target: ElementLike | null;
  key?: string; shiftKey?: boolean; altKey?: boolean;
  isComposing?: boolean; defaultPrevented?: boolean;
}
type Listener = (event: DomEvent) => void;
interface ElementLike {
  tagName: string; parentElement: ElementLike | null; isConnected: boolean;
  textContent: string | null; innerHTML: string; hidden: boolean;
  disabled?: boolean; value?: string; title: string;
  style: {
    setProperty(name: string, value: string, priority?: string): void;
    getPropertyValue(name: string): string;
    getPropertyPriority(name: string): string;
    removeProperty(name: string): string;
  };
  closest(selector: string): ElementLike | null;
  querySelector(selector: string): ElementLike | null;
  querySelectorAll(selector: string): ArrayLike<ElementLike>;
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  getClientRects(): { length: number };
  appendChild(child: ElementLike): unknown;
  insertBefore(child: ElementLike, before: ElementLike): unknown;
  remove(): void;
  addEventListener(type: string, listener: Listener, capture?: boolean): void;
  removeEventListener(type: string, listener: Listener, capture?: boolean): void;
  dispatchEvent(event: unknown): boolean;
  attachShadow(options: { mode: "open" }): ElementLike;
  focus(options?: { preventScroll: boolean }): void;
  click(): void;
}
interface InputLike extends ElementLike {
  value: string; selectionStart: number; selectionEnd: number;
  disabled: boolean; readOnly: boolean;
  setSelectionRange(start: number, end: number): void;
}
interface BrowserEnv {
  document: {
    activeElement: ElementLike | null;
    querySelectorAll(selector: string): ArrayLike<ElementLike>;
    createElement(tag: string): ElementLike;
    addEventListener(type: string, listener: Listener, capture?: boolean): void;
    removeEventListener(type: string, listener: Listener, capture?: boolean): void;
  };
  Event: new (type: string, options: { bubbles: boolean }) => unknown;
  HTMLTextAreaElement: { prototype: object };
  getComputedStyle(element: ElementLike): { visibility: string; display: string };
  MutationObserver: new (callback: () => void) => { observe(element: unknown, options: object): void; disconnect(): void };
}
const browser = globalThis as unknown as BrowserEnv;
export function hasDesktopDom(): boolean {
  return "document" in globalThis && "HTMLTextAreaElement" in globalThis;
}
function visible(element: ElementLike): boolean {
  return element.isConnected && !element.closest('[hidden], [inert], [aria-hidden="true"]') &&
    element.getClientRects().length > 0 && browser.getComputedStyle(element).visibility !== "hidden" &&
    browser.getComputedStyle(element).visibility !== "collapse";
}
function setInput(input: InputLike, text: string, locale: UiLocale): void {
  const setter = Object.getOwnPropertyDescriptor(browser.HTMLTextAreaElement.prototype, "value")?.set;
  if (!setter) throw new Error(translator(locale)("errorIncompatible"));
  setter.call(input, text);
  input.dispatchEvent(new browser.Event("input", { bubbles: true }));
}
function findSendButton(root: ElementLike): ElementLike | null {
  return Array.from(root.querySelectorAll('button, [role="button"]')).find((button) =>
    /^(send(?:\s|$)|发送|发送消息)/i.test(button.getAttribute("aria-label") ?? "") &&
    button.getAttribute("aria-disabled") !== "true" && !button.disabled) ?? null;
}
function findRoot(marker: ElementLike): ElementLike | null {
  // The plugin hides its own pill. Check the surrounding toolbar rather than
  // the hidden button when deciding whether its Agent view is still active.
  const scope = marker.closest('button, [role="button"]')?.parentElement ?? marker.parentElement;
  if (!scope || scope.closest('[hidden], [inert], [aria-hidden="true"]')) return null;
  for (let node: ElementLike | null = scope; node; node = node.parentElement) {
    const style = browser.getComputedStyle(node);
    if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse") return null;
  }
  const direct = marker.closest(ROOT);
  if (direct) return visible(direct) ? direct : null;
  for (let node = marker.parentElement; node; node = node.parentElement) {
    const roots = Array.from(node.querySelectorAll(ROOT)).filter(visible);
    if (roots.length === 1) return roots[0];
    if (roots.length > 1) return null;
  }
  return null;
}
const CSS = [
  ":host{display:block;font-family:inherit;color:var(--ha-foreground,inherit);font-size:13px;line-height:1.45;margin:0 0 9px;}",
  ":host([hidden]){display:none!important}",
  "*{box-sizing:border-box}button,textarea{font:inherit;color:inherit}",
  "button{cursor:pointer;border:1px solid var(--ha-border,currentColor);border-radius:8px;padding:6px 10px;background:var(--ha-surface1,transparent);text-align:left}",
  "button:hover{background:var(--ha-surface2,transparent)}button:disabled{cursor:default;opacity:.5}",
  "button:focus-visible,textarea:focus-visible{outline:2px solid var(--ha-accent,currentColor);outline-offset:2px}",
  ".line,.choices{display:flex;align-items:center;gap:6px}.choices{flex-wrap:wrap}",
  ".line{justify-content:space-between;margin-bottom:6px}",
  ".quiet{border:0;background:transparent;padding:3px 5px;color:var(--ha-foregroundMuted,inherit);font-size:12px;white-space:nowrap}",
  ".choice[aria-pressed=true]{border-color:var(--ha-accent,currentColor);color:var(--ha-accent,currentColor)}",
  ".choice{max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
  ".error{font-size:12px;color:var(--ha-statusDanger,inherit);margin-top:6px;white-space:pre-wrap}.status{font-size:12px;color:var(--ha-foregroundMuted,inherit)}",
  "[hidden]{display:none!important}",
].join("\n");
interface Binding {
  agentId: string; root: ElementLike; input: InputLike; host: ElementLike; shadow: ElementLike;
  marker: ElementLike;
  choices: ElementLike; status: ElementLike; error: ElementLike;
  refresh: ElementLike; signature: string; transaction: number;
  filled?: { text: string };
  composing: boolean; onInput: Listener; compositionStart: Listener; compositionEnd: Listener;
  cancelSend?: () => void;
  hiddenPill?: { element: ElementLike; display: string; priority: string };
}
export class DesktopBridge {
  private targets: DesktopTarget[] = [];
  private bindings = new Map<ElementLike, Binding>();
  private themes = new Map<string, PluginTheme>();
  private activeAgents = new Set<string>();
  private departedAgents = new Set<string>();
  private observer: InstanceType<BrowserEnv["MutationObserver"]>;
  private unsubscribe: () => void;
  private stopped = false;
  private scanning = false;
  private scanTimer: ReturnType<typeof setTimeout> | undefined;
  private departureTimer: ReturnType<typeof setTimeout> | undefined;
  constructor(private readonly store: ReplyStore, private readonly actions: DesktopActions, private locale: UiLocale = "zh-CN") {
    this.observer = new browser.MutationObserver(() => this.scheduleScan());
    this.observer.observe(browser.document, { childList: true, subtree: true, attributes: true,
      attributeFilter: ["style", "class", "hidden", "inert", "aria-hidden", "data-testid"] });
    this.unsubscribe = store.subscribe(() => { for (const binding of this.bindings.values()) this.render(binding); });
    browser.document.addEventListener("keydown", this.keydown, true);
    browser.document.addEventListener("click", this.click, true);
  }
  setTargets(targets: DesktopTarget[]): void { this.targets = targets; this.scan(); }
  setLocale(locale: UiLocale): void {
    if (this.locale === locale) return;
    this.locale = locale;
    for (const binding of this.bindings.values()) this.render(binding);
  }
  setTheme(agentId: string, theme: PluginTheme): void {
    this.themes.set(agentId, theme);
    for (const binding of this.bindings.values()) if (binding.agentId === agentId) this.applyTheme(binding);
  }
  visibleAgentIds(): string[] {
    this.scan();
    return [...this.activeAgents];
  }
  private scheduleScan(): void {
    if (this.scanTimer || this.scanning || this.stopped) return;
    this.scanTimer = setTimeout(() => { this.scanTimer = undefined; this.scan(); }, 0);
  }
  private scan(): void {
    if (this.stopped || this.scanning) return;
    this.scanning = true;
    try {
      const markers = Array.from(browser.document.querySelectorAll('[data-testid^="help-answer-target:"]'));
      const live = new Set<ElementLike>();
      const candidates = new Map<ElementLike, Array<{ agentId: string; marker: ElementLike; input: InputLike }>>();
      for (const marker of markers) {
        const target = this.targets.find((item) => item.marker === marker.getAttribute("data-testid"));
        if (!target) continue;
        const root = findRoot(marker);
        const input = root?.querySelector(INPUT) as InputLike | null;
        if (!root || !input) continue;
        const entries = candidates.get(root) ?? [];
        entries.push({ agentId: target.agentId, marker, input });
        candidates.set(root, entries);
      }
      for (const [root, entries] of candidates) {
        const direct = entries.filter((entry) => entry.marker.closest(ROOT) === root);
        const matches = direct.length ? direct : entries;
        // During a reused-composer transition, fail closed until its identity
        // is unambiguous. Never let DOM order pick an unrelated Agent.
        if (new Set(matches.map((entry) => entry.agentId)).size !== 1) continue;
        const { agentId, marker, input } = matches[0];
        live.add(root);
        const old = this.bindings.get(root);
        if (old && old.agentId === agentId && old.input === input) {
          old.marker = marker; this.syncPill(old); continue;
        }
        if (old) this.unmount(old);
        this.bindings.set(root, this.mount(root, input, agentId, marker));
      }
      for (const [root, binding] of this.bindings) if (!live.has(root) || !root.isConnected) {
        this.unmount(binding); this.bindings.delete(root);
      }
      const active = new Set([...this.bindings.values()].filter((binding) => this.ownsComposer(binding)).map((binding) => binding.agentId));
      for (const agentId of this.activeAgents) if (!active.has(agentId)) this.departedAgents.add(agentId);
      for (const agentId of active) this.departedAgents.delete(agentId);
      this.activeAgents = active;
      if (active.size) this.expireDeparted();
      else if (this.departedAgents.size && !this.departureTimer) {
        // Allow a same-task DOM remount, but do not retain candidates when
        // leaving the last Agent for a file tab or another empty screen.
        this.departureTimer = setTimeout(() => {
          this.scan(); this.departureTimer = undefined; this.expireDeparted();
        }, 0);
      }
    } finally { this.scanning = false; }
  }
  private expireDeparted(): void {
    const departed = [...this.departedAgents];
    this.departedAgents.clear();
    for (const agentId of departed) if (!this.activeAgents.has(agentId)) {
      for (const binding of this.bindings.values()) if (binding.agentId === agentId) binding.filled = undefined;
      this.store.dismiss(agentId);
    }
  }
  private mount(root: ElementLike, input: InputLike, agentId: string, marker: ElementLike): Binding {
    const host = browser.document.createElement("div");
    host.setAttribute("data-testid", "help-answer-inline"); host.setAttribute("data-agent-id", agentId);
    const shadow = host.attachShadow({ mode: "open" });
    // Model content is assigned through textContent/value, never innerHTML.
    shadow.innerHTML = '<style>' + CSS + '</style><div class="line"><span class="status" role="status"></span><div><button class="quiet refresh" type="button"></button><button class="quiet settings" type="button"></button></div></div><div class="choices"></div><div class="error" role="alert" hidden></div>';
    root.parentElement?.insertBefore(host, root);
    const element = (selector: string) => shadow.querySelector(selector)!;
    const binding: Binding = { agentId, root, input, host, shadow, marker, choices: element(".choices"),
      status: element(".status"), error: element(".error"), refresh: element(".refresh"),
      signature: "", transaction: 0, composing: false,
      onInput: () => {
        if (binding.filled && !this.store.get(agentId).sending && !input.value.startsWith(binding.filled.text)) {
          binding.filled = undefined; this.store.clear(agentId);
        }
      },
      compositionStart: () => { binding.composing = true; },
      compositionEnd: () => { binding.composing = false; },
    };
    binding.refresh.addEventListener("click", () => this.actions.regenerate(agentId));
    element(".settings").addEventListener("click", () => this.actions.settings());
    input.addEventListener("input", binding.onInput);
    input.addEventListener("compositionstart", binding.compositionStart);
    input.addEventListener("compositionend", binding.compositionEnd);
    this.applyTheme(binding); this.render(binding);
    return binding;
  }
  private applyTheme(binding: Binding): void {
    const theme = this.themes.get(binding.agentId);
    if (theme) for (const [name, color] of Object.entries(theme.colors)) binding.host.style.setProperty("--ha-" + name, color);
  }
  private restorePill(binding: Binding): void {
    const pill = binding.hiddenPill;
    if (!pill) return;
    if (pill.element.style.getPropertyValue("display") === "none" &&
        pill.element.style.getPropertyPriority("display") === "important") {
      if (pill.display) pill.element.style.setProperty("display", pill.display, pill.priority);
      else pill.element.style.removeProperty("display");
    }
    binding.hiddenPill = undefined;
  }
  private syncPill(binding: Binding): void {
    const element = binding.marker.closest('button, [role="button"]');
    if (binding.hiddenPill?.element !== element) this.restorePill(binding);
    if (!element) return;
    if (!binding.hiddenPill) binding.hiddenPill = { element,
      display: element.style.getPropertyValue("display"), priority: element.style.getPropertyPriority("display") };
    // Keep the SDK icon/identity marker mounted: visible:false would remove it
    // and detach the inline UI. Only the containing desktop button is hidden.
    if (element.style.getPropertyValue("display") !== "none" ||
        element.style.getPropertyPriority("display") !== "important") element.style.setProperty("display", "none", "important");
  }
  private render(binding: Binding): void {
    const view = this.store.get(binding.agentId), { batch, selected } = view;
    const t = translator(this.locale);
    binding.host.setAttribute("lang", this.locale);
    binding.shadow.querySelector(".settings")!.textContent = t("settings");
    const hidden = !this.ownsComposer(binding) || view.awaitingReply || view.busy || batch.phase !== "ready" || !batch.suggestions.length;
    if (binding.host.hidden !== hidden) binding.host.hidden = hidden;
    this.syncPill(binding);
    const busy = view.sending || batch.phase === "generating" || view.busy;
    binding.status.textContent = t("youCanReply");
    binding.refresh.textContent = t("regenerate");
    binding.refresh.disabled = busy;
    const signature = JSON.stringify([batch.suggestions, selected?.id, busy]);
    if (binding.signature !== signature) {
      binding.signature = signature; binding.choices.innerHTML = "";
      for (const item of batch.suggestions) {
        const button = browser.document.createElement("button");
        button.setAttribute("type", "button"); button.setAttribute("class", "choice");
        button.setAttribute("aria-pressed", String(selected?.id === item.id));
        button.textContent = item.label; button.title = item.text; button.disabled = busy;
        button.addEventListener("click", () => this.fill(binding.agentId, item, binding.root));
        binding.choices.appendChild(button);
      }
    }
    binding.error.textContent = view.error ?? generationErrorText(batch, this.locale) ?? "";
    binding.error.hidden = !binding.error.textContent;
  }
  private ownsComposer(binding: Binding): boolean {
    return binding.marker.isConnected && this.targets.some((target) => target.agentId === binding.agentId &&
      target.marker === binding.marker.getAttribute("data-testid")) &&
      findRoot(binding.marker) === binding.root && binding.root.querySelector(INPUT) === binding.input;
  }
  fill(agentId: string, suggestion: Suggestion, root?: ElementLike): boolean {
    this.scan();
    const binding = [...this.bindings.values()].find((b) => b.agentId === agentId &&
      (!root || b.root === root) && visible(b.root) && this.ownsComposer(b));
    const t = translator(this.locale);
    if (!binding) { this.store.error(agentId, t("errorNoComposer")); return false; }
    const view = this.store.get(agentId);
    if (view.busy || view.sending || view.awaitingReply || view.batch.phase !== "ready" ||
        !view.batch.suggestions.some((item) => item.id === suggestion.id) ||
        binding.input.disabled || binding.input.readOnly || binding.composing) return false;
    if (binding.input.value.trimStart().startsWith("/")) {
      this.store.error(agentId, t("errorSlashCommand")); return false;
    }
    const text = fillReply(binding.input.value, suggestion.text, binding.filled?.text ?? view.selected?.text);
    const previous = binding.filled;
    binding.filled = { text: suggestion.text };
    try {
      if (binding.input.value !== text) setInput(binding.input, text, this.locale);
      this.store.choose(agentId, suggestion);
      binding.input.focus({ preventScroll: true });
      binding.input.setSelectionRange(text.length, text.length);
      return true;
    } catch {
      binding.filled = previous;
      this.store.error(agentId, t("errorIncompatible"));
      return false;
    }
  }
  private keydown: Listener = (event) => {
    if (event.key !== "Enter" || event.shiftKey || event.altKey || event.isComposing || event.defaultPrevented) return;
    this.scan();
    const binding = [...this.bindings.values()].find((b) => b.input === event.target);
    if (!binding || binding.input.value.trimStart().startsWith("/")) return;
    const transaction = this.prepare(binding);
    if (transaction) void transaction.settle();
  };
  private click: Listener = (event) => {
    this.scan();
    const button = event.target?.closest('button, [role="button"]');
    if (!button) return;
    const binding = [...this.bindings.values()].find((b) => findSendButton(b.root) === button);
    if (!binding || binding.input.value.trimStart().startsWith("/")) return;
    const transaction = this.prepare(binding);
    if (transaction) void transaction.settle();
  };
  private prepare(binding: Binding): { settle(): Promise<void>; rollback(message?: string): void } | null {
    const view = this.store.get(binding.agentId);
    const original = binding.input.value;
    if (!this.ownsComposer(binding) || !original.trim() || !view.batch.anchor || binding.input.disabled || binding.input.readOnly ||
        !this.store.beginSend(binding.agentId, true)) return null;
    const seq = ++binding.transaction;
    const canceled = () => this.stopped || !this.ownsComposer(binding) || binding.transaction !== seq;
    let finished = false;
    const rollback = (message: string | null = null, restoreDraft = true) => {
      if (finished || binding.transaction !== seq) return;
      finished = true; binding.cancelSend = undefined;
      if (restoreDraft && binding.input.isConnected && this.ownsComposer(binding) && !binding.input.value) setInput(binding.input, original, this.locale);
      this.store.finishSend(binding.agentId, false, message);
    };
    binding.cancelSend = () => rollback(translator(this.locale)("errorComposerSwitched"), false);
    return { rollback, settle: async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      if (canceled()) return;
      // Native autocomplete/newline handlers own their edits; never rewrite them.
      if (binding.input.value) {
        rollback(); return;
      }
      let poll: ReturnType<typeof setInterval> | undefined;
      const restored = new Promise<boolean>((resolve) => {
        poll = setInterval(() => { if (canceled() || binding.input.value === original) resolve(false); }, 100);
      });
      try {
        const accepted = await Promise.race([
          this.actions.confirm(binding.agentId, view.batch.anchor!, original, () => finished || canceled()), restored,
        ]);
        if (canceled() || finished) return;
        if (accepted) { finished = true; binding.cancelSend = undefined;
          binding.filled = undefined;
          this.store.finishSend(binding.agentId, true, null, { sourceKey: view.batch.sourceKey, anchor: view.batch.anchor }); }
        else rollback(translator(this.locale)("errorUnconfirmed"));
      } catch { rollback(translator(this.locale)("errorSendFailed")); }
      finally { if (poll) clearInterval(poll); }
    } };
  }
  private unmount(binding: Binding): void {
    binding.cancelSend?.(); binding.transaction++;
    binding.input.removeEventListener("input", binding.onInput);
    binding.input.removeEventListener("compositionstart", binding.compositionStart);
    binding.input.removeEventListener("compositionend", binding.compositionEnd);
    this.restorePill(binding); binding.host.remove();
  }
  destroy(): void {
    for (const binding of this.bindings.values()) binding.cancelSend?.();
    this.stopped = true;
    if (this.scanTimer) clearTimeout(this.scanTimer);
    if (this.departureTimer) clearTimeout(this.departureTimer);
    this.observer.disconnect(); this.unsubscribe();
    browser.document.removeEventListener("keydown", this.keydown, true);
    browser.document.removeEventListener("click", this.click, true);
    for (const binding of this.bindings.values()) this.unmount(binding);
    this.bindings.clear();
    this.activeAgents.clear(); this.departedAgents.clear();
  }
}
