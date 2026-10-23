import { test, expect, type Page } from "@playwright/test";

test.beforeEach(async ({ page }) => { await page.goto("/"); });
const widget = (page: Page, agent = "a") => page.locator('[data-testid="help-answer-inline"][data-agent-id="' + agent + '"]');
const input = (page: Page, agent = "A") => page.getByRole("textbox", { name: "补充要求 " + agent });
const send = (page: Page, agent = "a") => page.getByTestId("pane-" + agent).getByRole("button", { name: "Send message", exact: true });
const first = "先按这个方案实现桌面版。";
const second = "先把候选回复的交互细化一下。";

for (const phase of ["idle", "generating", "error"]) test("hides the entry and suggestions while " + phase, async ({ page }) => {
  await page.evaluate((phase) => {
    const store = (window as any).fixture.store;
    store.receive({ ...store.get("a").batch, phase, error: phase === "error" ? "Unavailable" : null });
  }, phase);
  await expect(widget(page)).toBeHidden();
  await expect(page.getByTestId("help-answer-pill-a")).toBeHidden();
  await expect(widget(page, "b")).toBeVisible();
});

test("hides the entry when the model returns no suggestions", async ({ page }) => {
  await page.evaluate(() => {
    const store = (window as any).fixture.store;
    store.receive({ ...store.get("a").batch, suggestions: [] });
  });
  await expect(widget(page)).toBeHidden();
  await expect(page.getByTestId("help-answer-pill-a")).toBeHidden();
});

test("keeps short clickable labels and fills the full reply into the native composer without sending", async ({ page }) => {
  const choice = widget(page).getByRole("button", { name: "按方案实现", exact: true });
  await expect(choice).toHaveText("按方案实现");
  await expect(choice).toHaveAttribute("title", first);
  await expect(page.getByTestId("help-answer-pill-a")).toBeHidden();
  await choice.click();
  await expect(input(page)).toHaveValue(first);
  await expect(input(page)).toBeFocused();
  await expect(send(page)).toBeEnabled();
  await expect(widget(page).getByRole("textbox")).toHaveCount(0);
  await expect(page.getByTestId("sent-a")).toBeEmpty();
});

test("preserves an existing draft, avoids duplicate insertion, and replaces only the unchanged candidate prefix", async ({ page }) => {
  await input(page).fill("  保留现有输入方式。 ");
  await widget(page).getByRole("button", { name: "按方案实现", exact: true }).click();
  await expect(input(page)).toHaveValue(first + "\n\n  保留现有输入方式。 ");
  await widget(page).getByRole("button", { name: "按方案实现", exact: true }).click();
  await expect(input(page)).toHaveValue(first + "\n\n  保留现有输入方式。 ");
  await input(page).fill(first + "\n\n加上我补充的要求。 ");
  await widget(page).getByRole("button", { name: "先细化交互", exact: true }).click();
  await expect(input(page)).toHaveValue(second + "\n\n加上我补充的要求。 ");
  await expect(widget(page).getByRole("button", { name: "先细化交互", exact: true })).toHaveAttribute("aria-pressed", "true");
});

test("preserves manually rewritten text when another candidate is selected", async ({ page }) => {
  await widget(page).getByRole("button", { name: "按方案实现", exact: true }).click();
  await input(page).fill("这是我自己改写的回复。");
  await widget(page).getByRole("button", { name: "先细化交互", exact: true }).click();
  await expect(input(page)).toHaveValue(second + "\n\n这是我自己改写的回复。");
});

test("edits and submits the native draft exactly once while retaining attachments", async ({ page }) => {
  await widget(page).getByRole("button", { name: "按方案实现", exact: true }).click();
  await input(page).fill("先把桌面版交互做出来。");
  await send(page).click();
  await expect(page.getByTestId("sent-a")).toHaveText("先把桌面版交互做出来。");
  await expect(widget(page)).toBeHidden();
  await expect(page.getByTestId("help-answer-pill-a")).toBeHidden();
  expect(await page.evaluate(() => (window as any).fixture.sent[0].attachment)).toBe(true);
});

test("Enter sends the filled native draft without merging the suggestion a second time", async ({ page }) => {
  await input(page).fill("保留原稿。");
  await widget(page).getByRole("button", { name: "按方案实现", exact: true }).click();
  await input(page).press("Enter");
  await expect(page.getByTestId("sent-a")).toHaveText(first + "\n\n保留原稿。");
  await expect(widget(page)).toBeHidden();
});

test("Shift+Enter and IME composition preserve the actual composer contents", async ({ page }) => {
  await widget(page).getByRole("button", { name: "按方案实现", exact: true }).click();
  await input(page).press("Shift+Enter");
  await expect(page.getByTestId("sent-a")).toBeEmpty();
  const draft = await input(page).inputValue();
  await input(page).dispatchEvent("keydown", { key: "Enter", isComposing: true, bubbles: true });
  await expect(input(page)).toHaveValue(draft);
  await expect(page.getByTestId("sent-a")).toBeEmpty();
});

test("does not insert a candidate during an active IME composition", async ({ page }) => {
  await input(page).fill("正在输入");
  await input(page).dispatchEvent("compositionstart");
  await widget(page).getByRole("button", { name: "按方案实现", exact: true }).click();
  await expect(input(page)).toHaveValue("正在输入");
  await input(page).dispatchEvent("compositionend");
  await widget(page).getByRole("button", { name: "按方案实现", exact: true }).click();
  await expect(input(page)).toHaveValue(first + "\n\n正在输入");
});

test("waits for the host to enable its send button after native draft insertion", async ({ page }) => {
  await page.evaluate(() => (window as any).fixture.setBehavior("slow-enable"));
  await widget(page).getByRole("button", { name: "按方案实现", exact: true }).click();
  await expect(input(page)).toHaveValue(first);
  await expect(send(page)).toBeEnabled();
  await send(page).click();
  await expect(page.getByTestId("sent-a")).toHaveText(first);
});

test("keeps the entire filled draft after a failed send and retries without duplication", async ({ page }) => {
  await page.evaluate(() => (window as any).fixture.setBehavior("failure"));
  await input(page).fill("原有草稿");
  await widget(page).getByRole("button", { name: "按方案实现", exact: true }).click();
  const draft = first + "\n\n原有草稿";
  await send(page).click();
  await expect(input(page)).toHaveValue(draft);
  await expect(widget(page).getByRole("button", { name: "按方案实现", exact: true })).toBeEnabled();
  await page.evaluate(() => (window as any).fixture.setBehavior("success"));
  await send(page).click();
  await expect(page.getByTestId("sent-a")).toHaveText(draft);
  await expect(widget(page)).toBeHidden();
});

for (const submit of ["button", "Enter"]) test("hides suggestions after an ordinary draft is sent with " + submit, async ({ page }) => {
  await input(page).fill("直接发送自己的回答。");
  if (submit === "Enter") await input(page).press("Enter"); else await send(page).click();
  await expect(page.getByTestId("sent-a")).toHaveText("直接发送自己的回答。");
  await expect(widget(page)).toBeHidden();
  await expect(page.getByTestId("help-answer-pill-a")).toBeHidden();
  await expect(widget(page, "b")).toBeVisible();
});

test("rejects stale suggestions after submission and preserves the next native draft", async ({ page }) => {
  await page.evaluate(() => { (window as any).fixture.previous = (window as any).fixture.store.get("a").batch; });
  await widget(page).getByRole("button", { name: "按方案实现", exact: true }).click();
  await send(page).click();
  await expect(widget(page)).toBeHidden();
  await input(page).fill("下一轮的新草稿");
  await page.evaluate(() => {
    const fixture = (window as any).fixture;
    fixture.store.receive(fixture.previous);
    fixture.bridge.setTargets(["a", "b"].map((agentId) => ({ agentId, marker: "help-answer-target:fixture:" + agentId })));
  });
  await expect(widget(page)).toBeHidden();
  await page.evaluate(() => {
    const fixture = (window as any).fixture;
    fixture.store.receive({ ...fixture.previous, sourceKey: "new-reply", anchor: { epoch: "e", seq: 12 } });
  });
  await expect(widget(page)).toBeVisible();
  await expect(input(page)).toHaveValue("下一轮的新草稿");
});

test("keeps fills and sends isolated between two visible conversations", async ({ page }) => {
  await widget(page).getByRole("button", { name: "按方案实现", exact: true }).click();
  await expect(input(page, "B")).toHaveValue("");
  await widget(page, "b").getByRole("button", { name: "先补测试", exact: true }).click();
  await expect(input(page)).toHaveValue(first);
  await send(page, "b").click();
  await expect(page.getByTestId("sent-b")).toHaveText("先补齐会话隔离和发送恢复的测试。");
  await expect(input(page)).toHaveValue(first);
  await expect(page.getByTestId("sent-a")).toBeEmpty();
});

test("leaves autocomplete Enter and autocomplete edits entirely to the native composer", async ({ page }) => {
  await widget(page).getByRole("button", { name: "按方案实现", exact: true }).click();
  await input(page).fill(first + "\n\n补全前");
  await page.evaluate(() => (window as any).fixture.setBehavior("autocomplete"));
  await input(page).press("Enter");
  await expect(input(page)).toHaveValue(first + "\n\n补全前");
  await page.evaluate(() => (window as any).fixture.setBehavior("autocomplete-edit"));
  await input(page).press("Enter");
  await expect(input(page)).toHaveValue(first + "\n\n补全后的内容");
  await expect(page.getByTestId("sent-a")).toBeEmpty();
});

test("keeps slash commands untouched when a candidate is clicked", async ({ page }) => {
  await input(page).fill("/help");
  await widget(page).getByRole("button", { name: "按方案实现", exact: true }).click();
  await expect(input(page)).toHaveValue("/help");
  await expect(widget(page).getByRole("alert")).toHaveText("请先完成输入框中的斜杠命令，再填入候选回复。");
  await expect(page.getByTestId("sent-a")).toBeEmpty();
});

test("rejects fills into a disabled or read-only composer", async ({ page }) => {
  await input(page).fill("保留草稿");
  await input(page).evaluate((element: HTMLTextAreaElement) => { element.disabled = true; });
  await widget(page).getByRole("button", { name: "按方案实现", exact: true }).click();
  await expect(input(page)).toHaveValue("保留草稿");
  await input(page).evaluate((element: HTMLTextAreaElement) => { element.disabled = false; element.readOnly = true; });
  await widget(page).getByRole("button", { name: "按方案实现", exact: true }).click();
  await expect(input(page)).toHaveValue("保留草稿");
});

test("keeps the filled native draft when the language changes or suggestions are regenerated", async ({ page }) => {
  await widget(page).getByRole("button", { name: "按方案实现", exact: true }).click();
  await input(page).fill("Keep my edited native draft.");
  await page.evaluate(() => (window as any).fixture.bridge.setLocale("en"));
  await expect(widget(page).getByRole("button", { name: "Try another set", exact: true })).toBeVisible();
  await expect(widget(page).getByRole("button", { name: "Settings", exact: true })).toBeVisible();
  await expect(input(page)).toHaveValue("Keep my edited native draft.");
  await page.evaluate(() => {
    const store = (window as any).fixture.store;
    store.receive({ ...store.get("a").batch, phase: "generating" });
  });
  await expect(widget(page)).toBeHidden();
  await expect(page.getByTestId("help-answer-pill-a")).toBeHidden();
  await page.evaluate(() => {
    const store = (window as any).fixture.store;
    store.receive({ ...store.get("a").batch, phase: "ready" });
  });
  await expect(widget(page)).toBeVisible();
  await expect(input(page)).toHaveValue("Keep my edited native draft.");
});

test("shows English validation messages when filling a candidate", async ({ page }) => {
  await page.evaluate(() => (window as any).fixture.bridge.setLocale("en"));
  await input(page).fill("/help");
  await widget(page).getByRole("button", { name: "按方案实现", exact: true }).click();
  await expect(widget(page).getByRole("alert")).toHaveText("Finish the slash command in the composer before adding a suggested reply.");
});

test("releases the submission lock when the native composer is removed", async ({ page }) => {
  await widget(page).getByRole("button", { name: "按方案实现", exact: true }).click();
  await send(page).click();
  await page.getByTestId("pane-a").evaluate((element) => element.remove());
  await expect.poll(() => page.evaluate(() => (window as any).fixture.store.get("a").sending)).toBe(false);
});

test("unloading restores the SDK button style and keeps native draft contents", async ({ page }) => {
  await widget(page).getByRole("button", { name: "按方案实现", exact: true }).click();
  await page.evaluate(() => (window as any).fixture.bridge.destroy());
  await expect(page.getByTestId("help-answer-pill-a")).toBeVisible();
  await expect(widget(page)).toHaveCount(0);
  await expect(input(page)).toHaveValue(first);
});

test("switches a candidate after the same conversation is remounted without appending the old one", async ({ page }) => {
  await input(page).fill("保留补充");
  await widget(page).getByRole("button", { name: "按方案实现", exact: true }).click();
  await page.evaluate(() => {
    const bridge = (window as any).fixture.bridge;
    bridge.setTargets([]);
    bridge.setTargets(["a", "b"].map((agentId) => ({ agentId, marker: "help-answer-target:fixture:" + agentId })));
  });
  await widget(page).getByRole("button", { name: "先细化交互", exact: true }).click();
  await expect(input(page)).toHaveValue(second + "\n\n保留补充");
});

test("fills the clicked pane when the same conversation is displayed twice", async ({ page }) => {
  await page.evaluate(() => {
    document.querySelector('[data-testid="help-answer-target:fixture:b"]')!.setAttribute("data-testid", "help-answer-target:fixture:a");
    (window as any).fixture.bridge.setTargets([{ agentId: "a", marker: "help-answer-target:fixture:a" }]);
  });
  await page.getByTestId("pane-b").getByRole("button", { name: "按方案实现", exact: true }).click();
  await expect(input(page, "B")).toHaveValue(first);
  await expect(input(page)).toHaveValue("");
});

test("does not restore a pending submission into a reused composer after its identity changes", async ({ page }) => {
  await page.evaluate(() => (window as any).fixture.setBehavior("unconfirmed"));
  await widget(page).getByRole("button", { name: "按方案实现", exact: true }).click();
  await send(page).click();
  await page.evaluate(() => {
    document.querySelector('[data-testid="help-answer-target:fixture:a"]')!.setAttribute("data-testid", "help-answer-target:fixture:other");
    (window as any).fixture.bridge.setTargets([{ agentId: "b", marker: "help-answer-target:fixture:b" }]);
  });
  await expect.poll(() => page.evaluate(() => (window as any).fixture.store.get("a").sending)).toBe(false);
  await expect(input(page)).toHaveValue("");
});

test("renders candidate labels literally and inserts model text without HTML execution", async ({ page }) => {
  await page.evaluate(() => {
    const store = (window as any).fixture.store;
    store.receive({ ...store.get("a").batch, suggestions: [{ id: "x", label: "<img src=x>", text: "<script>alert(1)</script>" }] });
  });
  await widget(page).getByRole("button", { name: "<img src=x>", exact: true }).click();
  await expect(input(page)).toHaveValue("<script>alert(1)</script>");
  await expect(page.getByTestId("sent-a")).toBeEmpty();
});

test("captures the native-input interaction", async ({ page }) => {
  await widget(page).getByRole("button", { name: "先细化交互", exact: true }).click();
  await page.screenshot({ path: "test-results/desktop-preview.png", fullPage: true });
});
