import { spawn } from "node:child_process";
import { realpath, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { createInterface } from "node:readline/promises";
import {
  buildGraphs,
  buildHandoff,
  estimateHandoffTokens,
  handoffHardLimit,
  handoffTargets,
  handoffText,
  scanCodex,
  type HandoffTarget,
} from "../../core/src/index.js";
import { handoffOwners } from "../../core/src/handoff-content.js";
import { readHandoffGit } from "../../core/src/handoff-git.js";

type Graphs = Awaited<ReturnType<typeof buildGraphs>>;

export interface HandoffOptions {
  session?: string;
  lane?: string;
  cwd?: string;
  to?: string;
  copy?: boolean;
  out?: string;
  json?: boolean;
  preview?: boolean;
  format?: string;
  "codex-home"?: string;
}

export function selectHandoff(graphs: Graphs, options: HandoffOptions) {
  const lanes = graphs.flatMap((graph) =>
    graph.lanes.map((lane) => ({ graph, lane })),
  );
  if (options.lane !== undefined) {
    const ids = lanes.filter(({ lane }) => lane.id === options.lane);
    const matches = ids.length
      ? ids
      : lanes.filter(({ lane }) => lane.name === options.lane);
    if (matches.length > 1)
      throw new Error(
        "主线名称或 ID 有多个匹配，请用 --cwd 缩小范围并指定主线 ID。",
      );
    if (!matches[0]) throw new Error("未找到指定主线。");
    const { graph, lane } = matches[0];
    return {
      title: lane.name,
      repoRoot: graph.repoRoot,
      sessions: lane.sessions,
      allSessions: graph.lanes.flatMap((item) => item.sessions),
    };
  }

  const candidates = lanes.flatMap(({ graph, lane }) =>
    lane.sessions.map((session) => ({ graph, lane, session })),
  );
  const matches =
    options.session === undefined
      ? candidates
          .sort((a, b) => {
            const left = a.session.endedAt || a.session.startedAt;
            const right = b.session.endedAt || b.session.startedAt;
            if (left !== right) return left < right ? 1 : -1;
            return a.session.id < b.session.id
              ? -1
              : a.session.id > b.session.id
                ? 1
                : 0;
          })
          .slice(0, 1)
      : candidates.filter(({ session }) => session.id === options.session);
  if (!matches[0])
    throw new Error(
      options.session !== undefined
        ? "未找到指定会话。"
        : "当前目录没有匹配的 Codex 会话。",
    );
  const { graph, lane, session } = matches[0];
  const allSessions = graph.lanes.flatMap((item) => item.sessions);
  if (options.session === undefined)
    return {
      title: lane.name,
      repoRoot: graph.repoRoot,
      sessions: lane.sessions,
      allSessions,
    };
  const owner = handoffOwners(allSessions).get(session.id);
  return {
    title: owner?.title || lane.name,
    repoRoot: graph.repoRoot,
    sessions: [owner ?? session],
    allSessions,
  };
}

export function validateHandoffOptions(options: HandoffOptions) {
  if (
    (options.session !== undefined && options.lane !== undefined) ||
    [options.copy, options.out !== undefined, options.json].filter(Boolean)
      .length > 1
  )
    return "会话和主线选择互斥，--copy、--out、--json 也只能选一项。";
  if (
    options.to !== undefined &&
    !handoffTargets.some((target) => target === options.to)
  )
    return "--to 只接受 claude、codex 或 md。";
  if (options.format === "agent-handoff")
    return "离线环境未核实 agent-handoff 约定，本版本仅支持 --format tlineage。";
  if (options.format !== undefined && options.format !== "tlineage")
    return "仅支持 --format tlineage。";
}

async function allowedOutput(path: string, codexHome?: string) {
  const parent = await realpath(dirname(path));
  const roots = [
    join(homedir(), ".codex"),
    join(homedir(), ".claude"),
    process.env.CODEX_HOME,
    process.env.CLAUDE_CONFIG_DIR,
    codexHome,
  ].filter((item): item is string => Boolean(item));
  for (const root of roots) {
    const absolute = resolve(root);
    for (const candidate of [
      absolute,
      await realpath(absolute).catch(() => absolute),
    ]) {
      const fromRoot = relative(candidate, parent);
      if (
        !fromRoot ||
        (!isAbsolute(fromRoot) &&
          fromRoot !== ".." &&
          !fromRoot.startsWith(".." + sep))
      )
        return false;
    }
  }
  return true;
}

function writeClipboard(command: string, args: string[], text: string) {
  return new Promise<boolean>((complete) => {
    const child = spawn(command, args, {
      stdio: ["pipe", "ignore", "ignore"],
      timeout: 2500,
    });
    child.once("error", () => complete(false));
    child.stdin.on("error", () => complete(false));
    child.once("close", (code) => complete(code === 0));
    child.stdin.end(text, "utf8");
  });
}

async function copyHandoff(text: string) {
  if (process.platform === "darwin") return writeClipboard("pbcopy", [], text);
  if (process.platform === "win32") return writeClipboard("clip.exe", [], text);
  if (
    process.env.WAYLAND_DISPLAY &&
    (await writeClipboard("wl-copy", [], text))
  )
    return true;
  if (process.env.DISPLAY)
    return writeClipboard("xclip", ["-selection", "clipboard"], text);
  return false;
}

async function previewExport(markdown: string) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    process.stdout.write(markdown);
    return;
  }
  process.stdout.write(markdown);
  const tty = createInterface({
    input: process.stdin,
    output: process.stderr,
    terminal: true,
  });
  try {
    const action = (
      await tty.question("按回车导出，输入 e 替换正文，输入 q 取消：")
    )
      .trim()
      .toLowerCase();
    if (action === "") return markdown;
    if (action !== "e") return;
    const replacement: string[] = [];
    process.stderr.write("粘贴编辑后的 Markdown，单独输入 .end 结束：\n");
    let finished = false;
    for await (const line of tty) {
      if (line === ".end") {
        finished = true;
        break;
      }
      replacement.push(line);
    }
    if (!finished) return;
    const safe = handoffText(replacement.join("\n").trim()) + "\n";
    if (estimateHandoffTokens(safe) > handoffHardLimit)
      throw new Error("编辑后的接力包超过 4,000 token，未导出。");
    if (safe.trim()) return safe;
  } finally {
    tty.close();
  }
}

export async function handoffCommand(options: HandoffOptions) {
  const invalid = validateHandoffOptions(options);
  if (invalid) {
    process.stderr.write(invalid + "\n");
    return 1;
  }
  const now = Date.now();
  const scan = await scanCodex({ home: options["codex-home"], cache: false });
  const cwd =
    options.cwd !== undefined || (!options.session && !options.lane)
      ? resolve(options.cwd ?? ".")
      : undefined;
  const graphs = await buildGraphs(scan.sessions, { cwd, now });
  let selection: ReturnType<typeof selectHandoff>;
  try {
    selection = selectHandoff(graphs, options);
  } catch (error) {
    if (error instanceof Error) process.stderr.write(error.message + "\n");
    return 3;
  }

  const pack = await buildHandoff({
    ...selection,
    now,
    target: options.to as HandoffTarget | undefined,
    readGit: readHandoffGit,
  });
  let markdown = pack.markdown;
  if (options.preview && (options.out !== undefined || options.copy)) {
    try {
      const approved = await previewExport(markdown);
      if (approved === undefined) return 0;
      markdown = approved;
    } catch {
      process.stderr.write("预览已结束，未导出接力包。\n");
      return 1;
    }
  }

  if (options.out !== undefined) {
    const path = resolve(options.out);
    try {
      if (!(await allowedOutput(path, options["codex-home"]))) {
        process.stderr.write("输出路径位于代理会话或配置目录中，未写入。\n");
        return 1;
      }
      await writeFile(path, markdown, { flag: "wx", mode: 0o600 });
      process.stdout.write(path + "\n");
    } catch {
      process.stderr.write(
        "无法写入接力包，请检查输出目录和文件名是否已存在。\n",
      );
      return 3;
    }
  } else if (options.copy) {
    if (!(await copyHandoff(markdown))) {
      process.stderr.write("剪贴板不可用，改为输出到终端。\n");
      process.stdout.write(markdown);
    }
  } else if (options.json) {
    const { markdown: rendered, ...structured } = pack;
    if (rendered)
      process.stdout.write(
        JSON.stringify({ schemaVersion: 1, ...structured }) + "\n",
      );
  } else process.stdout.write(markdown);

  const failed = scan.doctor.failures.length;
  if (failed) process.stderr.write(`有 ${failed} 个会话文件未能完整解析。\n`);
  return failed ? 2 : 0;
}
