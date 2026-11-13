import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { Evidence, messageText, safePath } from "./evidence.js";
import { readLines, type ReadOptions } from "./lines.js";
import { redact } from "./redact.js";
import {
  object,
  string,
  type AgentReader,
  type JsonObject,
  type Session,
  type SessionFileRef,
  type SessionParent,
} from "./types.js";
import { UsageAccumulator } from "./usage.js";

const known = new Set([
  "session_meta",
  "event_msg",
  "response_item",
  "turn_context",
  "compacted",
  "token_usage_record",
]);
const validName = /^[a-zA-Z][a-zA-Z0-9_.-]{0,127}$/;
const maxTypes = 256;
const missing = (error: unknown) => object(error).code === "ENOENT";

export function codexHome() {
  return process.env.CODEX_HOME || join(homedir(), ".codex");
}

export interface FileScan {
  ref: SessionFileRef;
  session?: Session;
  parse: Session["parse"];
  error?: string;
}

export function timestamp(value: unknown): string {
  return typeof value === "string" &&
    /^\d{4}-\d\d-\d\dT/.test(value) &&
    value.length <= 40 &&
    Number.isFinite(Date.parse(value))
    ? value
    : "";
}

function count(map: Map<string, number>, key: string) {
  const label = map.has(key) || map.size < maxTypes ? key : "[other]";
  map.set(label, (map.get(label) ?? 0) + 1);
}

function recordType(value: unknown): string {
  return typeof value === "string" && validName.test(value)
    ? redact(value)
    : "[unclassified]";
}

// Scan only tokens at object depth one. A nested payload type or an escaped
// string in the prefix must not stand in for a top-level type.
export function oversizedHeader(prefix: string): JsonObject {
  const result: JsonObject = {};
  let depth = 0;
  let key = "";
  let valueNext = false;
  for (const { 0: token } of prefix.matchAll(/"(?:[^"\\]|\\.)*"|[{}\[\]:,]/g)) {
    if (token === "{" || token === "[") depth++;
    else if (token === "}" || token === "]") depth--;
    else if (depth === 1 && token === ":") valueNext = true;
    else if (depth === 1 && token === ",") {
      key = "";
      valueNext = false;
    } else if (depth === 1 && token.startsWith('"')) {
      if (valueNext && (key === '"type"' || key === '"timestamp"')) {
        result[key.slice(1, -1)] = token.slice(1, -1);
      } else if (!valueNext) key = token;
    }
    if (result.type && result.timestamp) break;
  }
  return result;
}

function parentLinks(meta: JsonObject): SessionParent[] {
  const fork = string(meta.forked_from_id);
  const nested = object(object(object(meta.source).subagent).thread_spawn);
  const directParent = string(meta.parent_thread_id);
  const subagent = directParent || string(nested.parent_thread_id);
  const links: SessionParent[] = [];
  if (fork)
    links.push({
      kind: "fork",
      field: "forked_from_id",
      sessionId: redact(fork).slice(0, 256),
      provenance: "verified",
    });
  if (subagent)
    links.push({
      kind: "subagent",
      field: directParent
        ? "parent_thread_id"
        : "source.subagent.thread_spawn.parent_thread_id",
      sessionId: redact(subagent).slice(0, 256),
      provenance: "verified",
    });
  return links;
}

function safeError(error: unknown) {
  const code = object(error).code;
  const message = error instanceof Error ? error.message : "";
  if (/^ZSTD_[A-Z0-9_]+$/.test(message)) return message;
  if (
    code === "ENOENT" ||
    code === "EACCES" ||
    code === "EPERM" ||
    code === "EISDIR"
  )
    return code;
  return "READ_OR_DECODE_ERROR";
}

export class CodexReader implements AgentReader {
  readonly agent = "codex" as const;

  constructor(private readonly options: ReadOptions = {}) {}

  async discover(home = codexHome()): Promise<SessionFileRef[]> {
    const results: SessionFileRef[] = [];
    const folders = [
      resolve(home, "sessions"),
      resolve(home, "archived_sessions"),
    ];
    while (folders.length) {
      const base = folders.pop()!;
      let entries;
      try {
        entries = await readdir(base, { withFileTypes: true });
      } catch (error) {
        if (missing(error)) continue;
        throw error;
      }
      for (const entry of entries) {
        const path = join(base, entry.name);
        if (entry.isDirectory()) folders.push(path);
        if (!entry.isFile() || !/\.jsonl(?:\.zst)?$/.test(entry.name)) continue;
        try {
          const info = await stat(path);
          results.push({
            agent: this.agent,
            path,
            compressed: path.endsWith(".zst"),
            sizeBytes: info.size,
            mtimeMs: info.mtimeMs,
          });
        } catch (error) {
          if (!missing(error)) throw error;
        }
      }
    }
    return results.sort((a, b) =>
      a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
    );
  }

  async metadata(ref: SessionFileRef) {
    try {
      let seen = 0;
      for await (const line of readLines(ref.path, this.options)) {
        if (++seen > 16 || line.oversized) return;
        if (!line.text.trim()) continue;
        const row = object(JSON.parse(line.text));
        if (recordType(row.type) !== "session_meta") continue;
        const meta = object(row.payload);
        const id = redact(string(meta.id)).slice(0, 256);
        if (id)
          return {
            id,
            cwd: safePath(string(meta.cwd)),
            parents: parentLinks(meta),
          };
        return;
      }
    } catch {
      // The complete parser is authoritative for uncertain headers.
    }
  }

  async titles(home = codexHome()) {
    const titles = new Map<string, string>();
    try {
      for await (const line of readLines(
        join(home, "session_index.jsonl"),
        this.options,
      )) {
        if (line.oversized) continue;
        try {
          const row = object(JSON.parse(line.text));
          const id = string(row.id);
          const title = string(row.thread_name).trim();
          if (id && title)
            titles.set(redact(id).slice(0, 256), redact(title).slice(0, 60));
        } catch {
          // An index can be updated while it is being read.
        }
      }
    } catch {
      // Titles are optional, including for installations without an index.
    }
    return titles;
  }

  async parse(ref: SessionFileRef): Promise<Session[]> {
    const outcome = await this.scan(ref);
    return outcome.session ? [outcome.session] : [];
  }

  async scan(
    ref: SessionFileRef,
    forkPrefix?: ReadonlySet<string>,
  ): Promise<FileScan> {
    const parse: Session["parse"] = {
      ok: false,
      unknownTypes: {},
      recordTypes: {},
      truncatedLines: 0,
      badLines: 0,
      partialLines: 0,
      lineCount: 0,
      lastRecordAt: "",
      notes: [],
    };
    const evidence = new Evidence();
    const tokens = new UsageAccumulator(forkPrefix);
    const unknown = new Map<string, number>();
    const types = new Map<string, number>();
    let meta: JsonObject | undefined;
    let metaSeen = false;
    let startedAt = "";
    let model = "";
    let finalAssistantText = "";
    let error: string | undefined;
    const userMessages: Session["userMessages"] = [];
    const assistantOpenItems: NonNullable<Session["assistantOpenItems"]> = [];

    const keepAssistantOpenItems = (text: string, at: string) => {
      const safe = redact(text);
      for (const part of safe.split(/\r?\n|(?<=[。！？!?])\s*/u)) {
        const item = part.trim();
        if (!/\b(?:TODO|FIXME)\b|[?？]$/u.test(item)) continue;
        const excerpt =
          item.length <= 500
            ? item
            : item.slice(0, 235) + " […] " + item.slice(-235);
        assistantOpenItems.push({ text: excerpt, at });
        if (assistantOpenItems.length > 20) assistantOpenItems.shift();
      }
      return safe;
    };

    const keepUser = (text: string, at: string) => {
      if (!text || userMessages.length >= 50) return;
      const safe = redact(text).slice(0, 2000);
      if (
        userMessages.at(-1)?.text !== safe ||
        userMessages.at(-1)?.at !== at
      ) {
        userMessages.push({ text: safe, at });
      }
    };

    try {
      for await (const line of readLines(ref.path, this.options)) {
        parse.lineCount++;
        if (!line.text.trim() && !line.oversized) continue;
        evidence.pendingLastToolCall = false;
        let row: JsonObject;
        if (line.oversized) {
          parse.truncatedLines++;
          row = oversizedHeader(line.text);
        } else {
          try {
            row = object(JSON.parse(line.text));
            if (typeof row.type !== "string") {
              parse.badLines++;
              continue;
            }
          } catch {
            if (line.terminated) parse.badLines++;
            else parse.partialLines++;
            continue;
          }
        }
        const type = recordType(row.type);
        const when = timestamp(row.timestamp);
        if (when) parse.lastRecordAt = when;
        count(types, type);
        if (!known.has(type)) count(unknown, type);
        if (type === "session_meta" && !metaSeen) {
          metaSeen = true;
          if (line.oversized) {
            error = "SESSION_META_TOO_LARGE";
            break;
          }
          meta = object(row.payload);
          startedAt = timestamp(meta.timestamp) || when;
          continue;
        }
        if (line.oversized || !metaSeen) continue;
        const payload = object(row.payload);
        if (type === "turn_context") {
          tokens.startTurn(string(payload.turn_id));
          model = string(payload.model) || model;
        } else if (type === "token_usage_record") {
          tokens.record(payload);
        } else if (type === "event_msg") {
          if (
            payload.type === "task_started" ||
            payload.type === "turn_started"
          )
            tokens.startTurn(string(payload.turn_id));
          if (payload.type === "token_count")
            tokens.legacy(object(payload.info));
          if (payload.type === "item_completed") {
            const ms = payload.started_at_ms;
            const start =
              typeof ms === "number" &&
              Number.isFinite(ms) &&
              Math.abs(ms) <= 8.64e15
                ? new Date(ms).toISOString()
                : when;
            evidence.item(object(payload.item), start);
          }
        } else if (type === "response_item") {
          if (payload.type === "message") {
            const text = messageText(payload.content).trim();
            if (payload.role === "user") keepUser(text, when);
            if (payload.role === "assistant" && text) {
              const safe = keepAssistantOpenItems(text, when);
              if (payload.phase !== "commentary")
                finalAssistantText = safe.slice(0, 2000);
            }
          } else evidence.response(payload, when);
        }
      }
    } catch (failure) {
      error = safeError(failure);
    }

    parse.unknownTypes = Object.fromEntries(unknown);
    parse.recordTypes = Object.fromEntries(types);
    const id = string(meta?.id);
    if (!id || !meta) error ??= "SESSION_META_ID_MISSING";
    if (parse.badLines) error ??= "MALFORMED_LINES";
    if (evidence.touchesCapped)
      parse.notes.push("已达到单会话文件变更保留上限");
    if (error) parse.notes.push(error);
    parse.ok = !error;
    const result: FileScan = { ref, parse, ...(error ? { error } : {}) };
    if (!id || !meta) return result;

    const links = parentLinks(meta);
    const git = object(meta.git);
    const { commands, filesTouched, pending } = evidence.snapshot();
    const lastCheck = [...commands]
      .reverse()
      .find((run) => run.kind === "test" || run.kind === "build");
    const state = lastCheck?.exitCode ? "warn" : pending ? "open" : "done";
    const usage = tokens.finish(links.some((link) => link.kind === "fork"));
    if (parse.truncatedLines || parse.partialLines || error) {
      usage.quality = "approx";
      usage.note = [
        usage.note,
        "会话含超长行、截断尾行或解析异常，可能遗漏部分记录",
      ]
        .filter(Boolean)
        .join("。");
    }

    result.session = {
      id: redact(id).slice(0, 256),
      agent: this.agent,
      provenance: "verified",
      files: [{ ...ref, path: safePath(ref.path) }],
      alternates: [],
      cwd: safePath(string(meta.cwd)),
      ...(string(git.branch)
        ? { gitBranch: redact(string(git.branch)).slice(0, 256) }
        : {}),
      ...(string(git.commit_hash)
        ? { gitCommit: redact(string(git.commit_hash)).slice(0, 256) }
        : {}),
      ...(string(meta.cli_version)
        ? { agentVersion: redact(string(meta.cli_version)).slice(0, 256) }
        : {}),
      ...(model ? { model: redact(model).slice(0, 256) } : {}),
      startedAt,
      endedAt: parse.lastRecordAt || startedAt,
      title: (userMessages[0]?.text ?? "Codex 会话").slice(0, 60),
      titleProvenance: "inferred",
      userMessages,
      ...(finalAssistantText ? { finalAssistantText } : {}),
      ...(assistantOpenItems.length ? { assistantOpenItems } : {}),
      compactionSummaries: [],
      ...(links[0] ? { parent: links[0] } : {}),
      parents: links,
      usage,
      ...(tokens.forkAggregate ? { forkAggregate: tokens.forkAggregate } : {}),
      filesTouched,
      commands,
      pendingLastToolCall: evidence.pendingLastToolCall,
      state,
      stateReasons: [
        state === "warn"
          ? "当前文件中最近的测试或构建退出非零"
          : state === "open"
            ? "当前文件存在未结束的工具调用"
            : "当前文件未发现未结束命令或失败的最近检查",
      ],
      stateProvenance: "inferred",
      parse,
    };
    return result;
  }
}
