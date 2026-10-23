// Opt-in integration test: makes real calls to the host's configured metadata model.
// The local credential is read in memory and is never printed or persisted.
import { readFile, mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { DaemonClient } from "../node_modules/@getpaseo/client/dist/daemon-client.js";
import { createPaseoApi } from "@getpaseo/client";

const paseoHome = process.env.PASEO_HOME || join(homedir(), ".paseo");
const driver = new DaemonClient({
  url: process.env.PASEO_TEST_URL || "ws://127.0.0.1:6767/ws",
  clientId: "help-answer-live-verification", clientType: "cli", connectTimeoutMs: 5000,
  localCredential: async () => (await readFile(join(paseoHome, "local-credential"), "utf8")).trim(),
});
let api, workspace, agent, observation, workspaceObservation, notificationObservation, release, releaseWorkspaces, releaseNotifications, directory;
const helpers = new Map();
const runningControllers = new Set();
const backgroundWorkspaces = new Map();
const attention = [];
try {
  await driver.connect(); api = createPaseoApi(driver);
  notificationObservation = api.observeEvents(["agent_attention_required"], { notifications: true });
  releaseNotifications = notificationObservation.subscribe({
    snapshot() {},
    update(message) {
      if (message.type === "agent_attention_required") {
        attention.push({ agentId: message.payload.agentId, reason: message.payload.reason });
      } else if (message.type === "agent_stream" && message.payload.event.type === "attention_required") {
        attention.push({ agentId: message.payload.agentId, reason: message.payload.event.reason });
      }
    },
  });
  await notificationObservation.ready;
  const { config } = await api.config.get();
  const selection = config.metadataGeneration.providers[0];
  assert(selection, "真实生成验收需要主机已选择一个元数据模型");
  const provider = selection.provider + (selection.model ? "/" + selection.model : "");
  const page = await api.agents.list({ filter: { includeBackground: true }, page: { limit: 100 }, subscribe: {} });
  observation = page.subscription;
  const inspect = (value) => {
    if (value.labels?.["help-answer.role"] === "generator") helpers.set(value.id, value);
    if (value.labels?.["help-answer.controller"] === "true" && value.status === "running") runningControllers.add(value.id);
  };
  release = observation.subscribe({
    snapshot: (snapshot) => snapshot.entries.forEach((entry) => inspect(entry.agent)),
    update: (message) => {
      if (message.type === "agent_update" && message.payload.kind === "upsert") inspect(message.payload.agent);
    },
  });
  const workspacePage = await api.workspaces.list({ filter: { includeBackground: true }, page: { limit: 100 }, subscribe: {} });
  workspaceObservation = workspacePage.subscription;
  releaseWorkspaces = workspaceObservation.subscribe({
    snapshot: (snapshot) => snapshot.entries.forEach((value) => backgroundWorkspaces.set(value.id, value)),
    update: (message) => {
      if (message.type === "workspace_update" && message.payload.kind === "upsert") {
        const value = message.payload.workspace;
        if (value) backgroundWorkspaces.set(value.id, value);
      }
    },
  });
  directory = await mkdtemp(join(tmpdir(), "help-answer-live-"));
  workspace = await api.workspaces.create({
    source: { kind: "directory", path: directory }, title: "回复建议验收（后台）", background: true,
  });
  agent = await workspace.agents.create({
    config: { provider, thinkingOptionId: selection.thinkingOptionId, mcpServers: {} },
    title: "回复建议隔离验收",
    prompt: "这是一个回复建议插件的隔离验收，请不要使用任何工具。只回复这一句话：建议先实现桌面端的候选卡片，再验证会话隔离。你希望先细化交互，还是直接实现？",
    labels: { "help-answer.test": "true" },
  });
  const result = await agent.waitForFinish(30_000);
  assert.equal(result.status, "idle", result.error || "验收会话没有完成");
  console.log(JSON.stringify({ stage: "seed-complete", model: provider }));
  const batch = await driver.invokePluginRpc("help-answer", "suggestions.generate", { agentId: agent.id, force: false });
  assert.equal(batch.phase, "ready", batch.error || "没有生成候选");
  assert(batch.suggestions.length >= 1 && batch.suggestions.length <= 3, "候选数量不符合预期");
  const ownHelpers = [...helpers.values()].filter((value) => value.labels["help-answer.source-agent-id"] === agent.id);
  assert(ownHelpers.length, "未观察到插件的后台生成任务");
  const controllers = ownHelpers.filter((value) => value.labels["help-answer.controller"] === "true");
  assert(controllers.length, "未观察到后台服务会话");
  const controllerIds = new Set(controllers.map((value) => value.id));
  const checks = [];
  for (const helper of ownHelpers) {
    const controller = controllerIds.has(helper.id);
    assert.notEqual(helper.labels["paseo.parent-agent-id"], agent.id, "辅助任务不应绑定用户 Agent");
    if (controller) assert(!helper.labels["paseo.parent-agent-id"], "服务会话不应绑定用户 Agent");
    else assert(controllerIds.has(helper.labels["paseo.parent-agent-id"]), "生成任务应挂到独立后台服务会话");
    const snapshot = await api.agents.ref(helper.id).refresh();
    assert(snapshot?.agent.archivedAt, "辅助任务未归档");
    const helperWorkspace = backgroundWorkspaces.get(helper.workspaceId);
    assert(helperWorkspace?.background, "辅助工作区未隐藏");
    if (controller) {
      assert(!runningControllers.has(helper.id), "服务会话不应运行模型轮次");
    }
    checks.push({ role: controller ? "controller" : "generator", independentFromUser: true, background: true, archived: true });
  }
  await new Promise((resolve) => setTimeout(resolve, 350));
  assert(controllers.every((value) => !runningControllers.has(value.id)), "后台服务会话不应因子任务完成而启动模型轮次");
  assert(attention.some((event) => event.agentId === agent.id && event.reason === "finished"), "未收到普通会话完成事件，不能验证通知通道");
  const helperIds = new Set(ownHelpers.map((value) => value.id));
  const helperNotifications = attention.filter((event) => helperIds.has(event.agentId));
  assert.equal(helperNotifications.length, 0, "辅助任务不应触发 Agent Finish 提示");
  const report = { passed: true, model: batch.model, suggestions: batch.suggestions, helperChecks: checks,
    notifications: { ordinaryAgentFinishedObserved: true, helperNotifications: helperNotifications.length } };
  await mkdir("artifacts", { recursive: true });
  await writeFile("artifacts/live-smoke.json", JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report));
} finally {
  if (agent) await agent.archive().catch(() => undefined);
  if (workspace) await workspace.archive().catch(() => undefined);
  release?.(); releaseWorkspaces?.(); releaseNotifications?.();
  await observation?.release().catch(() => undefined);
  await workspaceObservation?.release().catch(() => undefined);
  await notificationObservation?.release().catch(() => undefined);
  await api?.dispose(); await driver.close();
  if (directory) await rm(directory, { recursive: true, force: true });
}
