import { NAMING } from "../../core/src/naming.js";
import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access, lstat, readFile } from "node:fs/promises";
import { delimiter, join, resolve } from "node:path";
import { promisify } from "node:util";

export type Agent = "codex" | "claude";
export type Launcher = { command: string; args: string[] };
export type RunAgent = (
  binary: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  cwd: string,
) => Promise<string>;
export const runAgent: RunAgent = async (binary, args, env, cwd) =>
  (
    await promisify(execFile)(binary, args, {
      env,
      cwd,
      timeout: 15000,
      maxBuffer: 1024 * 1024,
    })
  ).stdout;

export async function executable(name: string, env: NodeJS.ProcessEnv) {
  const suffix = process.platform === "win32" ? ".exe" : "";
  for (const entry of (env.PATH ?? "").split(delimiter).filter(Boolean)) {
    const path = resolve(entry, name + suffix);
    try {
      await access(path, constants.X_OK);
      if ((await lstat(path)).isFile() || (await lstat(path)).isSymbolicLink())
        return path;
    } catch {
      // Try the next PATH entry.
    }
  }
}

export async function optionalFile(path: string) {
  try {
    if (!(await lstat(path)).isFile()) throw new Error("拒绝操作非普通文件。");
    return await readFile(path);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return;
    throw error;
  }
}

function empty(value: unknown) {
  return (
    value == null ||
    (typeof value === "object" && Object.keys(value).length === 0)
  );
}

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new Error("无法核实代理配置。");
  return value as Record<string, unknown>;
}

function launcher(value: unknown): Launcher | null {
  const item = record(value);
  if (
    (item.type !== undefined && item.type !== "stdio") ||
    typeof item.command !== "string" ||
    (item.args !== undefined &&
      (!Array.isArray(item.args) ||
        !item.args.every((arg) => typeof arg === "string"))) ||
    !empty(item.env) ||
    !empty(item.env_vars) ||
    item.cwd != null
  )
    return null;
  return {
    command: item.command,
    args: (item.args as string[] | undefined) ?? [],
  };
}

export const sameLauncher = (
  left: Launcher | null | undefined,
  right: Launcher,
) =>
  Boolean(
    left &&
    left.command === right.command &&
    JSON.stringify(left.args) === JSON.stringify(right.args),
  );

export function agentPaths(agent: Agent, home: string, env: NodeJS.ProcessEnv) {
  const agentHome = resolve(
    agent === "codex"
      ? env.CODEX_HOME || join(home, ".codex")
      : env.CLAUDE_CONFIG_DIR || join(home, ".claude"),
  );
  return {
    agentHome,
    config:
      agent === "codex"
        ? join(agentHome, "config.toml")
        : join(home, ".claude.json"),
    skills: join(agentHome, "skills"),
  };
}

export function agentAdapter(
  agent: Agent,
  binary: string,
  config: string,
  env: NodeJS.ProcessEnv,
  cwd: string,
  run: RunAgent,
) {
  const invoke = async (...args: string[]) => {
    try {
      return await run(binary, ["mcp", ...args], env, cwd);
    } catch {
      throw new Error(`${agent} mcp 命令失败，请检查代理配置和权限。`);
    }
  };
  return {
    async current(): Promise<Launcher | null | undefined> {
      if (agent === "claude") {
        const file = await optionalFile(config);
        if (!file) return;
        const servers = record(JSON.parse(file.toString())).mcpServers;
        if (servers === undefined) return;
        const entries = record(servers);
        return Object.hasOwn(entries, NAMING.mcpService)
          ? launcher(entries[NAMING.mcpService])
          : undefined;
      }
      const list: unknown = JSON.parse(await invoke("list", "--json"));
      if (!Array.isArray(list)) throw new Error("无法核实 Codex MCP 列表。");
      if (
        !list.some((item: unknown) => record(item).name === NAMING.mcpService)
      )
        return;
      const item = record(
        JSON.parse(await invoke("get", NAMING.mcpService, "--json")),
      );
      if (
        item.name !== NAMING.mcpService ||
        item.enabled !== true ||
        item.startup_timeout_sec != null ||
        item.tool_timeout_sec != null ||
        item.enabled_tools != null ||
        item.disabled_tools != null
      )
        return null;
      return launcher(item.transport);
    },
    async add(value: Launcher) {
      if (agent === "codex")
        await invoke(
          "add",
          NAMING.mcpService,
          "--",
          value.command,
          ...value.args,
        );
      else
        await invoke(
          "add",
          "--transport",
          "stdio",
          "--scope",
          "user",
          NAMING.mcpService,
          "--",
          value.command,
          ...value.args,
        );
    },
    async remove() {
      if (agent === "codex") await invoke("remove", NAMING.mcpService);
      else await invoke("remove", "--scope", "user", NAMING.mcpService);
    },
  };
}
