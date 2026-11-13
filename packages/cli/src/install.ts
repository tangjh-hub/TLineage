import { NAMING } from "../../core/src/naming.js";
import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rmdir,
  unlink,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import {
  agentAdapter,
  agentPaths,
  executable,
  optionalFile,
  runAgent,
  sameLauncher,
  type Agent,
  type Launcher,
  type RunAgent,
} from "./install-agent.js";

const marker = NAMING.managedMarker;
const skill = "SKILL.md";
const digest = (bytes: Buffer) =>
  createHash("sha256").update(bytes).digest("hex");
type Receipt = {
  version: 1;
  tlineageVersion: string;
  agent: Agent;
  launcher: Launcher;
  skillHash: string;
};
type Managed = { receipt: Receipt; content: Buffer; manifest: Buffer };

async function readManaged(
  folder: string,
  agent: Agent,
): Promise<Managed | undefined> {
  try {
    if (!(await lstat(folder)).isDirectory())
      throw new Error("Skill 路径不是普通目录。");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return;
    throw error;
  }
  const files = (await readdir(folder)).sort();
  if (JSON.stringify(files) !== JSON.stringify([marker, skill]))
    throw new Error("已有同名 Skill 或额外文件，请先核对归属。");
  const content = await optionalFile(join(folder, skill));
  const manifest = await optionalFile(join(folder, marker));
  const receipt = manifest && (JSON.parse(manifest.toString()) as Receipt);
  if (
    !content ||
    !manifest ||
    !receipt ||
    receipt.version !== 1 ||
    receipt.agent !== agent ||
    typeof receipt.tlineageVersion !== "string" ||
    receipt.skillHash !== digest(content) ||
    typeof receipt.launcher?.command !== "string" ||
    !Array.isArray(receipt.launcher.args) ||
    !receipt.launcher.args.every((arg) => typeof arg === "string")
  )
    throw new Error("Skill 标记缺失、损坏或文件已被修改。");
  return { receipt, content, manifest };
}

async function put(folder: string, file: string, bytes: Buffer) {
  const temp = await mkdtemp(join(folder, ".tlineage-write-"));
  const path = join(temp, file);
  try {
    await writeFile(path, bytes, { flag: "wx", mode: 0o600 });
    await rename(path, join(folder, file));
  } finally {
    await unlink(path).catch(() => {});
    await rmdir(temp);
  }
}

async function removeSkill(folder: string) {
  for (const name of [skill, marker])
    await unlink(join(folder, name)).catch((error: unknown) => {
      if (!(
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ))
        throw error;
    });
  await rmdir(folder);
}

async function confirm(message = "确认执行？输入 yes 继续：") {
  const prompt = createInterface({
    input: process.stdin,
    output: process.stderr,
  });
  try {
    return /^(?:y|yes)$/i.test((await prompt.question(message)).trim());
  } catch {
    return false;
  } finally {
    prompt.close();
  }
}

export interface InstallOptions {
  agent: Agent;
  action: "install" | "uninstall";
  dryRun?: boolean;
  yes?: boolean;
  allProjects?: boolean;
  prewarm?: boolean;
  approvePrewarm?: () => Promise<boolean>;
  warmCache?: () => Promise<void>;
  env?: NodeJS.ProcessEnv;
  home?: string;
  cwd?: string;
  entry?: string;
  skillSource?: string | URL;
  run?: RunAgent;
  approve?: () => Promise<boolean>;
  output?: (line: string) => void;
}

export async function runInstall(options: InstallOptions) {
  const { agent, action } = options;
  const out =
    options.output ?? ((line: string) => process.stdout.write(line + "\n"));
  const env = options.env ?? process.env;
  const home = options.home ?? homedir();
  const cwd = options.cwd ?? process.cwd();
  const paths = agentPaths(agent, home, env);
  const folder = join(paths.skills, NAMING.skill);
  const backupRoot = resolve(
    env[NAMING.homeVariable] || join(home, NAMING.dataDirectory),
    NAMING.backupDirectory,
  );
  const binary = await executable(agent, env);
  const manifest =
    action === "install"
      ? (JSON.parse(
          await readFile(new URL("../package.json", import.meta.url), "utf8"),
        ) as {
          version: string;
          naming?: { distribution?: string };
          bin?: Record<string, string>;
        })
      : undefined;
  const packaged = manifest?.naming?.distribution === "npm";
  const entry = resolve(options.entry ?? process.argv[1]);
  const command = packaged
    ? Object.keys(manifest?.bin ?? {})[0]
    : process.execPath;
  if (!command) throw new Error("发布包缺少 CLI 命令。");
  if (packaged) {
    const installed = await executable(command, env);
    if (
      !installed ||
      /(?:^|[\\/])(?:_npx|node_modules)[\\/]/.test(installed) ||
      (await realpath(installed)) !== (await realpath(entry))
    )
      throw new Error(
        "请先将候选包全局安装，并将其 bin 目录加入 Codex 的 PATH。",
      );
  }
  const desired = {
    command,
    args: [
      ...(packaged ? [] : [entry]),
      "mcp",
      ...(options.allProjects ? ["--all-projects"] : []),
    ],
  };
  out(
    `${options.dryRun ? "[dry-run] " : ""}${agent === "claude" ? "[experimental，未经实测] " : ""}${action} ${agent}`,
  );
  out(
    `MCP 配置 ${paths.config}，由 ${agent} mcp ${action === "install" ? "add" : "remove"} 管理 tlineage 项。`,
  );
  if (action === "install")
    out(
      `启动命令 ${JSON.stringify([desired.command, ...desired.args])}，范围 ${options.allProjects ? "跨项目" : "仅启动仓库"}。`,
    );
  if (action === "install") {
    out(
      packaged
        ? "启动命令从 Codex 的 PATH 查找，需保留全局安装。"
        : "启动命令使用本机绝对路径（node 与脚本），移动或删除仓库、升级 Node 后 MCP 会失效。",
    );
    if (options.allProjects)
      out("跨项目模式首次需要完整扫描所有会话，可能较慢。");
  }
  out(`Skill ${join(folder, skill)}，归属标记 ${join(folder, marker)}。`);
  if (agent === "codex" && action === "install")
    out(`如目录不存在，将创建 ${paths.agentHome}。`);
  out(`实际改动前备份到 ${backupRoot}。`);
  if (binary) out(`检测到代理 ${binary}。`);
  else out(`找不到 ${agent}，仅可预览。`);
  if (options.prewarm && action === "install" && agent === "codex")
    out(
      `可选预热：${options.allProjects ? "跨项目" : "仅当前仓库"}，写入 ~/.tlineage/cache/mcp，安装后另行确认。`,
    );
  if (options.dryRun) return 0;
  if (!binary) return 3;
  if (agent === "claude" && env.CLAUDE_CONFIG_DIR) {
    out("experimental：自定义 Claude 配置位置未核实，仅可预览。");
    return 3;
  }
  if (!options.yes && !(await (options.approve ?? confirm)())) {
    out("已取消。");
    return 0;
  }

  async function prewarm() {
    if (!options.prewarm || action !== "install" || agent !== "codex") return;
    if (
      !(await (
        options.approvePrewarm ??
        (() => confirm("确认预热 MCP 缓存？输入 yes 继续："))
      )())
    ) {
      out("已跳过缓存预热。");
      return;
    }
    try {
      if (options.warmCache) await options.warmCache();
      else {
        const { locateRepository } =
          await import("../../core/src/repositories.js");
        const { scanCodex } = await import("../../core/src/scan.js");
        const { zstdCapability } = await import("../../core/src/zstd.js");
        const { createDiskCache } = await import("../../mcp/src/disk-cache.js");
        const repoRoot = options.allProjects
          ? undefined
          : (await locateRepository(cwd))?.repoRoot;
        if (!repoRoot && !options.allProjects) throw new Error("No repository");
        const cacheHome =
          env[NAMING.homeVariable] ?? join(home, NAMING.dataDirectory);
        const disk = createDiskCache(
          paths.agentHome,
          JSON.stringify([null, zstdCapability()]),
          { home, configuredHome: cacheHome },
        );
        await disk.status();
        const batch = disk.batch();
        const result = await scanCodex({
          home: paths.agentHome,
          repoRoot,
          cache: "read-only",
          cacheHome,
          sessionCache: batch,
        });
        await batch.flush();
        if (
          result.sessions.length &&
          !(await disk.status()).entries &&
          !result.doctor.cache.hits
        )
          throw new Error("Cache unavailable");
      }
      out("MCP 缓存预热完成。");
    } catch {
      out("安装成功，缓存预热未完成。请核对当前仓库及缓存目录权限。");
    }
  }

  await mkdir(backupRoot, { recursive: true, mode: 0o700 });
  const lock = join(backupRoot, ".lock-" + agent);
  try {
    await mkdir(lock, { mode: 0o700 });
  } catch {
    throw new Error("同一代理有安装或卸载操作正在执行。");
  }
  try {
    try {
      if (!(await lstat(paths.skills)).isDirectory())
        throw new Error("Skill 父目录不是普通目录。");
    } catch (error) {
      if (!(
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ))
        throw error;
    }
    const old = await readManaged(folder, agent);
    if (action === "uninstall" && !old) {
      out("未发现 TLineage 管理标记。");
      return 0;
    }
    const oldConfig = await optionalFile(paths.config);
    if (action === "install" && agent === "codex")
      await mkdir(paths.agentHome, { recursive: true, mode: 0o700 });
    const adapter = agentAdapter(
      agent,
      binary,
      paths.config,
      env,
      cwd,
      options.run ?? runAgent,
    );
    const current = await adapter.current();
    if (
      current !== undefined &&
      (!old || !sameLauncher(current, old.receipt.launcher))
    )
      throw new Error("现有 tlineage MCP 项不符合管理标记，请先核对归属。");
    const tlineageVersion = manifest?.version;
    const content =
      action === "install"
        ? await readFile(
            options.skillSource ??
              new URL(
                "../integrations/skills/tlineage/SKILL.md",
                import.meta.url,
              ),
          )
        : undefined;
    if (
      content &&
      old &&
      sameLauncher(current, desired) &&
      old.receipt.skillHash === digest(content) &&
      old.receipt.tlineageVersion === tlineageVersion
    ) {
      out("已安装，MCP 注册与 Skill 已核对。");
      await prewarm();
      return 0;
    }

    const backup = await mkdtemp(join(backupRoot, agent + "-"));
    if (oldConfig)
      await writeFile(
        join(backup, agent === "codex" ? "config.toml" : "claude.json"),
        oldConfig,
        { mode: 0o600 },
      );
    if (old) {
      await writeFile(join(backup, skill), old.content, { mode: 0o600 });
      await writeFile(join(backup, marker), old.manifest, { mode: 0o600 });
    }
    out(`备份 ${backup}`);
    let created = false;
    try {
      if (content) {
        await mkdir(paths.skills, { recursive: true, mode: 0o700 });
        if (!old) {
          await mkdir(folder, { mode: 0o700 });
          created = true;
        }
        const receipt: Receipt = {
          version: 1,
          tlineageVersion: tlineageVersion!,
          agent,
          launcher: desired,
          skillHash: digest(content),
        };
        await put(folder, skill, content);
        await put(
          folder,
          marker,
          Buffer.from(JSON.stringify(receipt, null, 2) + "\n"),
        );
        if (!sameLauncher(current, desired)) await adapter.add(desired);
        if (!sameLauncher(await adapter.current(), desired))
          throw new Error("MCP 注册验证失败。");
        out("TLineage 已安装，MCP 注册与 Skill 已验证。");
      } else {
        if (current) await adapter.remove();
        if ((await adapter.current()) !== undefined)
          throw new Error("MCP 卸载验证失败。");
        await removeSkill(folder);
        out("TLineage 管理的注册和 Skill 已卸载。");
      }
    } catch {
      try {
        const actual = await adapter.current();
        if (
          content &&
          sameLauncher(actual, desired) &&
          !sameLauncher(current, desired)
        ) {
          if (current) await adapter.add(current);
          else await adapter.remove();
        } else if (!content && current && actual === undefined)
          await adapter.add(current);
        if (old) {
          await mkdir(folder, { recursive: true, mode: 0o700 });
          await put(folder, skill, old.content);
          await put(folder, marker, old.manifest);
        } else if (created) await removeSkill(folder);
      } catch {
        throw new Error("操作失败，自动恢复未完成，请使用已报告的备份核对。");
      }
      throw new Error("操作失败，已尝试恢复，请核对已报告的备份。");
    }
    await prewarm();
    return 0;
  } finally {
    await rmdir(lock);
  }
}
