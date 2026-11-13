import { redact } from "./redact.js";
import {
  object,
  string,
  type CommandRun,
  type FileTouch,
  type JsonObject,
} from "./types.js";

export const safePath = (path: string) =>
  redact(path.replace(/\\/g, "/")).slice(0, 4096);
const integer = (value: unknown) =>
  typeof value === "number" && Number.isSafeInteger(value) ? value : undefined;

function args(value: unknown): JsonObject {
  if (typeof value !== "string") return object(value);
  try {
    return object(JSON.parse(value));
  } catch {
    return {};
  }
}

export function messageText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return string(object(content).text);
  return content
    .map((part) => string(object(part).text))
    .filter(Boolean)
    .join("\n");
}

function commandKind(command: string): CommandRun["kind"] {
  if (
    /\b(?:pytest|vitest|jest|(?:npm|pnpm|yarn|go|cargo|mvn|gradle) (?:run )?test)\b/.test(
      command,
    )
  )
    return "test";
  if (/\b(?:build|tsc|make)\b/.test(command)) return "build";
  if (/\b(?:lint|eslint|prettier|ruff)\b/.test(command)) return "lint";
  if (/\bgit\s+\w/.test(command)) return "git";
  return "other";
}

function outputTail(output: string) {
  return redact(output).slice(-2000).split(/\r?\n/).slice(-40).join("\n");
}

const oldHeader =
  /^(?:(?:Chunk ID:[^\r\n]*|Wall time:[^\r\n]*)\r?\n){0,2}Process exited with code (-?\d+)(?=\r?\n|$)/;
const runningHeader =
  /^(?:(?:Chunk ID:[^\r\n]*|Wall time:[^\r\n]*)\r?\n){0,2}Process running with session ID (\d+)(?=\r?\n|$)/;
const maxTouches = 10000;

export class Evidence {
  private readonly touched = new Map<string, FileTouch>();
  private readonly runs = new Map<
    string,
    { run: CommandRun; structured: boolean; pending: boolean }
  >();
  private readonly toolSessions = new Map<string, string>();
  private readonly pollCalls = new Map<string, string>();
  private anonymous = 0;
  touchesCapped = false;
  pendingLastToolCall = false;

  private touch(rawPath: string, op: FileTouch["op"], structured = false) {
    if (!rawPath) return;
    const path = safePath(rawPath);
    if (this.touched.size >= maxTouches && !this.touched.has(path)) {
      this.touchesCapped = true;
      return;
    }
    const modified =
      (structured && op === "modify") ||
      this.touched.get(path)?.fileChangeModified;
    this.touched.set(path, {
      path,
      op,
      provenance: "verified",
      ...(modified ? { fileChangeModified: true } : {}),
    });
  }

  private patch(text: string) {
    if (!/^\*\*\* Begin Patch\s*$/m.test(text)) return;
    let updating = "";
    for (const match of text.matchAll(
      /^\*\*\* (Add File|Update File|Delete File|Move to): ([^\r\n]+)/gm,
    )) {
      const [, kind, path] = match;
      if (kind === "Move to") {
        if (updating) {
          this.touch(updating, "delete");
          this.touch(path, "create");
          updating = "";
        }
      } else {
        updating = kind === "Update File" ? path : "";
        this.touch(
          path,
          kind === "Add File"
            ? "create"
            : kind === "Delete File"
              ? "delete"
              : "modify",
        );
      }
    }
  }

  item(item: JsonObject, startedAt?: string) {
    if (item.type === "FileChange" && item.status !== "failed") {
      for (const [path, value] of Object.entries(object(item.changes))) {
        const change = object(value);
        const move = string(change.move_path);
        if (move) {
          this.touch(path, "delete");
          this.touch(move, "create");
        } else {
          const type = string(change.type).toLowerCase();
          this.touch(
            path,
            type === "add"
              ? "create"
              : type === "delete"
                ? "delete"
                : type === "update" || type === "modify"
                  ? "modify"
                  : "unknown",
            item.status === "completed" || item.status === undefined,
          );
        }
      }
      return;
    }
    if (item.type !== "CommandExecution") return;
    this.pendingLastToolCall = item.status === "in_progress";
    const argv = item.command;
    const command = Array.isArray(argv)
      ? argv.filter((part) => typeof part === "string").join(" ")
      : string(argv);
    if (!command) return;
    const id = string(item.id);
    const previous = this.runs.get(id)?.run;
    const output =
      messageText(item.aggregated_output) ||
      messageText(item.formatted_output) ||
      [messageText(item.stdout), messageText(item.stderr)]
        .filter(Boolean)
        .join("\n");
    const structuredExit =
      integer(item.exit_code) ?? previous?.structured?.exitCode;
    const exitCode = structuredExit ?? previous?.exitCode;
    const structuredTail = output
      ? redact(output)
          .trimEnd()
          .split(/\r?\n/)
          .slice(-40)
          .map((line) => line.slice(0, 400))
          .join("\n")
      : previous?.structured?.outputTail;
    this.put(
      id,
      {
        command: redact(command).slice(0, 2000),
        kind: commandKind(command),
        provenance: "verified",
        ...(startedAt ? { startedAt } : {}),
        ...(exitCode !== undefined ? { exitCode } : {}),
        ...(output ? { outputTail: outputTail(output) } : {}),
        structured: {
          ...(structuredExit !== undefined ? { exitCode: structuredExit } : {}),
          ...(structuredTail ? { outputTail: structuredTail } : {}),
        },
      },
      true,
      item.status === "in_progress",
    );
  }

  response(payload: JsonObject, startedAt?: string) {
    const type = payload.type;
    const id = string(payload.call_id);
    if (type === "function_call_output" || type === "custom_tool_call_output") {
      this.result(id, messageText(payload.output));
      return;
    }
    if (type !== "function_call" && type !== "custom_tool_call") return;
    this.pendingLastToolCall =
      payload.status !== "completed" && payload.status !== "failed";
    const parsed = args(payload.arguments ?? payload.input);
    if (payload.name === "apply_patch" && payload.status !== "failed") {
      this.patch(
        string(parsed.patch) || string(parsed.input) || string(payload.input),
      );
      return;
    }
    if (payload.name === "write_stdin" && id) {
      const session =
        typeof parsed.session_id === "number"
          ? String(parsed.session_id)
          : string(parsed.session_id);
      const commandId = this.toolSessions.get(session);
      if (commandId) {
        this.pollCalls.set(id, commandId);
        if (this.pollCalls.size > 200)
          this.pollCalls.delete(this.pollCalls.keys().next().value!);
      }
      return;
    }
    if (payload.name !== "exec_command" && payload.name !== "shell_command")
      return;
    const command = string(parsed.cmd) || string(parsed.command);
    if (!command || this.runs.get(id)?.structured) return;
    this.put(
      id,
      {
        command: redact(command).slice(0, 2000),
        kind: commandKind(command),
        provenance: "verified",
        ...(startedAt ? { startedAt } : {}),
      },
      false,
      Boolean(id),
    );
  }

  private put(
    id: string,
    run: CommandRun,
    structured: boolean,
    pending: boolean,
  ) {
    this.runs.set(id || `anonymous:${++this.anonymous}`, {
      run,
      structured,
      pending,
    });
    if (this.runs.size > 200) this.runs.delete(this.runs.keys().next().value!);
  }

  private result(id: string, output: string) {
    const commandId = this.pollCalls.get(id) ?? id;
    this.pollCalls.delete(id);
    const entry = this.runs.get(commandId);
    if (!entry) return;
    const running = runningHeader.exec(output);
    if (running) {
      this.toolSessions.set(running[1], commandId);
      if (this.toolSessions.size > 200)
        this.toolSessions.delete(this.toolSessions.keys().next().value!);
    }
    entry.pending = Boolean(running);
    this.pendingLastToolCall = entry.pending;
    const match = oldHeader.exec(output);
    const exitCode = match ? integer(Number(match[1])) : undefined;
    if (
      exitCode !== undefined &&
      (!entry.structured || entry.run.exitCode === undefined)
    ) {
      entry.run.exitCode = exitCode;
    }
    if (output && (!entry.structured || !entry.run.outputTail))
      entry.run.outputTail = outputTail(output);
  }

  snapshot() {
    return {
      commands: [...this.runs.values()].map(({ run }) => run),
      filesTouched: [...this.touched.values()],
      pending: [...this.runs.values()].some((entry) => entry.pending),
    };
  }
}
