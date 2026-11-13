export type Provenance = "verified" | "inferred";
export type AgentKind = "codex" | "claude-code";

export interface SessionFileRef {
  agent: AgentKind;
  path: string;
  compressed: boolean;
  sizeBytes: number;
  mtimeMs: number;
}

export interface UsageCounts {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  reasoning: number;
  total: number;
}

export type UsageSource = "token_count" | "token_usage_record";

export interface Usage extends UsageCounts {
  scope: "inFile";
  baseline?: UsageCounts & { source: UsageSource; provenance: "inferred" };
  threadCumulative?: UsageCounts & {
    source: UsageSource;
    provenance: "verified";
  };
  quality: "exact" | "approx";
  provenance: Provenance;
  note?: string;
}

export interface CommandRun {
  command: string;
  exitCode?: number;
  startedAt?: string;
  outputTail?: string;
  structured?: { exitCode?: number; outputTail?: string };
  kind: "test" | "build" | "lint" | "git" | "other";
  provenance: Provenance;
}

export interface FileTouch {
  path: string;
  op: "create" | "modify" | "delete" | "unknown";
  provenance: "verified";
  fileChangeModified?: boolean;
}

export interface SessionParent {
  kind: "fork" | "subagent";
  sessionId: string;
  field?:
    | "forked_from_id"
    | "parent_thread_id"
    | "source.subagent.thread_spawn.parent_thread_id";
  provenance: "verified";
}

export interface Session {
  id: string;
  agent: AgentKind;
  provenance: "verified";
  files: SessionFileRef[];
  alternates: SessionFileRef[];
  cwd: string;
  repoRoot?: string;
  worktreePath?: string;
  resolvedCwd?: string;
  gitBranch?: string;
  gitCommit?: string;
  agentVersion?: string;
  model?: string;
  startedAt: string;
  endedAt: string;
  title: string;
  titleProvenance: Provenance;
  userMessages: { at: string; text: string }[];
  finalAssistantText?: string;
  assistantOpenItems?: { at: string; text: string }[];
  compactionSummaries: string[];
  parent?: SessionParent;
  parents: SessionParent[];
  usage: Usage;
  forkAggregate?: { inFile: UsageCounts; excludedSignatures: number };
  filesTouched: FileTouch[];
  commands: CommandRun[];
  pendingLastToolCall?: boolean;
  state: "done" | "open" | "warn" | "idle";
  stateReasons: string[];
  stateProvenance: "inferred";
  parse: {
    ok: boolean;
    unknownTypes: Record<string, number>;
    recordTypes: Record<string, number>;
    truncatedLines: number;
    badLines: number;
    partialLines: number;
    lineCount: number;
    lastRecordAt: string;
    notes: string[];
  };
}

export interface AgentReader {
  agent: AgentKind;
  discover(home?: string): Promise<SessionFileRef[]>;
  parse(ref: SessionFileRef): Promise<Session[]>;
}

export type JsonObject = Record<string, unknown>;

export function object(value: unknown): JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
}

export function string(value: unknown): string {
  return typeof value === "string" ? value : "";
}
