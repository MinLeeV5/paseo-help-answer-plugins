import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, lstat, copyFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const exec = promisify(execFile);
const root = fileURLToPath(new URL("../", import.meta.url));
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== "--ref" || !args[1])) {
  throw new Error("Usage: npm run verify:install [-- --ref <git-ref>]");
}
const ref = args[1];
const directory = await mkdtemp(join(tmpdir(), "help-answer-install-check-"));
const home = join(directory, "daemon");
await mkdir(home, { mode: 0o700 });
const run = async (command, values) => (await exec(command, values, {
  cwd: root, timeout: 60_000, maxBuffer: 2 * 1024 * 1024,
})).stdout;
const cli = (values) => run("paseo", [...values, "--home", home]);
let startAttempted = false;
let ready = false;
let report;
try {
  let source = "https://github.com/MinLeeV5/paseo-help-answer-plugins.git";
  if (!ref) {
    source = join(directory, "source");
    await mkdir(source);
    const names = (await run("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"])).split("\0");
    for (const name of new Set(names.filter(Boolean))) {
      const from = join(root, name);
      const info = await lstat(from).catch((error) => {
        if (error.code === "ENOENT") return null;
        throw error;
      });
      if (!info) continue;
      if (!info.isFile()) throw new Error("Expected a regular source file: " + name);
      const to = join(source, name);
      await mkdir(dirname(to), { recursive: true });
      await copyFile(from, to);
    }
    if (await lstat(join(source, "node_modules")).catch(() => null)) {
      throw new Error("Clean source must not contain node_modules");
    }
  }
  await cli(["daemon", "config", "set", "daemon.listen", "127.0.0.1:0", "--string"]);
  await cli(["daemon", "config", "set", "daemon.relay.enabled", "false"]);
  await cli(["daemon", "config", "set", "pluginsEnabled", "true"]);
  startAttempted = true;
  await cli(["start", "--timeout", "45", "--json"]);
  ready = true;
  await cli(["plugin", "install", source, ...(ref ? ["--ref", ref] : []), "--json"]);
  const plugins = JSON.parse(await cli(["plugin", "ls", "help-answer", "--json"]));
  const plugin = plugins.find((entry) => entry.id === "help-answer");
  if (!plugin?.enabled || plugin.status !== "running") {
    throw new Error("Installed plugin is not enabled and running");
  }
  const sourceKind = plugin.installation?.identity?.kind;
  if (sourceKind !== (ref ? "git" : "directory")) throw new Error("Unexpected installed source kind");
  report = { passed: true, source: ref ? "git" : "clean-directory", ref: ref ?? null,
    pluginId: plugin.id, status: plugin.status, modelCalls: 0 };
} finally {
  if (startAttempted) {
    try { await cli(["daemon", "stop", "--timeout", "15", "--force", "--json"]); }
    catch (error) {
      if (ready) throw new Error("Could not stop the isolated verification daemon at " + home, { cause: error });
    }
  }
  await rm(directory, { recursive: true, force: true });
}
console.log(JSON.stringify(report, null, 2));
