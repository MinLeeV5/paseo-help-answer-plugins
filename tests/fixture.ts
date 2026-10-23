import { DesktopBridge } from "../client/web";
import { ReplyStore } from "../client/store";
import { emptyBatch } from "../shared/contracts";
const store = new ReplyStore();
const sent: Array<{ agentId: string; text: string; attachment: boolean }> = [];
const receipts = new Set<string>();
let behavior = "success";
const bridge = new DesktopBridge(store, {
  regenerate() {},
  settings() {},
  async confirm(agentId, _anchor, text, canceled) {
    const deadline = Date.now() + 1800;
    while (!canceled() && Date.now() < deadline) {
      if (receipts.has(agentId + ":" + text)) return true;
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
    return false;
  },
});
for (const agentId of ["a", "b"]) {
  store.receive({ ...emptyBatch(agentId), phase: "ready", sourceKey: "turn-1", anchor: { epoch: "e", seq: 8 },
    suggestions: [
      { id: agentId + "-1", label: "按方案实现", text: "先按这个方案实现桌面版。" },
      { id: agentId + "-2", label: "先细化交互", text: "先把候选回复的交互细化一下。" },
      { id: agentId + "-3", label: "先补测试", text: "先补齐会话隔离和发送恢复的测试。" },
    ], generatedAt: 1 });
  bridge.setTheme(agentId, { colors: {
    surface0: "#191b20", surface1: "#252932", surface2: "#303642", border: "#424853",
    foreground: "#e7e9ed", foregroundMuted: "#9ba2b0", accent: "#91b9e9", accentForeground: "#162436",
    statusSuccess: "#8dc99d", statusWarning: "#e1bd7d", statusDanger: "#ef9b9b",
  } });
  const root = document.querySelector('[data-testid="pane-' + agentId + '"] [data-testid="message-input-root"]')!;
  const input = root.querySelector("textarea")!, button = root.querySelector<HTMLButtonElement>(".native-send")!;
  const submit = () => {
    if (!input.value.trim()) return;
    const text = input.value;
    input.value = ""; button.disabled = true;
    if (behavior === "unconfirmed") return;
    if (behavior === "failure") { setTimeout(() => { input.value = text; button.disabled = false; }, 100); return; }
    sent.push({ agentId, text, attachment: agentId === "a" });
    document.querySelector('[data-testid="sent-' + agentId + '"]')!.textContent = text;
    setTimeout(() => receipts.add(agentId + ":" + text), 120);
  };
  input.addEventListener("input", () => {
    if (behavior === "slow-enable") setTimeout(() => { button.disabled = !input.value.trim(); }, 120);
    else button.disabled = !input.value.trim();
  });
  input.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
    if (behavior === "autocomplete") { event.preventDefault(); return; }
    if (behavior === "autocomplete-edit") {
      input.value = input.value.replace("补全前", "补全后的内容");
      event.preventDefault(); return;
    }
    event.preventDefault(); submit();
  });
  button.addEventListener("click", submit);
  button.disabled = true;
}
bridge.setTargets(["a", "b"].map((agentId) => ({ agentId, marker: "help-answer-target:fixture:" + agentId })));
Object.assign(window, { fixture: { store, bridge, sent, setBehavior(value: string) { behavior = value; } } });
