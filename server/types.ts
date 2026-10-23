import type { PluginHandlerContext } from "@getpaseo/plugin/server";

// Derive SDK types from the host-provided plugin facade so clean Git installs
// do not need a local copy of the development-only @getpaseo/client package.
export type PaseoApi = PluginHandlerContext["paseo"];
export type PaseoAgentHandle = ReturnType<PaseoApi["agents"]["ref"]>;
export type PaseoAgent = NonNullable<ReturnType<PaseoAgentHandle["current"]>>;
export type PaseoWorkspaceHandle = Awaited<ReturnType<PaseoApi["workspaces"]["create"]>>;
export type PaseoProviderSnapshotResult = Awaited<ReturnType<PaseoApi["providers"]["waitForReady"]>>;
