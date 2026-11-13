# 01 Architecture

## Repo layout (pnpm workspaces)
```
packages/core      readers (codex, claude), model, lanes, edges, usage, handoff, redact, cache
packages/viewer    builds the single-file HTML map from a ProjectMap
packages/cli       bin `tlineage`
packages/mcp       stdio MCP server (read-only tools)
integrations/      skills/tlineage/SKILL.md, claude-plugin/, codex-plugin/ (later milestones)
fixtures/          sanitized samples only
scripts/           sanitize-fixture, gen-demo
docs/
```
Publish one npm package that bundles core+cli+mcp+viewer (tsup). Name is configurable.

## Data flow
discover files → stream-parse each file into `Session` (cached by path+size+mtime) → group by cwd → build lanes → build edges → `ProjectMap` → render (HTML / Markdown / JSON / MCP response). Redaction runs inside the readers: no unredacted text leaves the parse step.

## Model (core/src/types.ts)
```ts
export type AgentKind = 'codex' | 'claude-code';
export type Provenance = 'verified' | 'inferred';
export interface SessionFileRef { agent: AgentKind; path: string; compressed: boolean; sizeBytes: number; mtimeMs: number }
export interface Usage { input: number; output: number; cacheRead: number; cacheWrite: number; reasoning: number; total: number; quality: 'exact' | 'approx'; note?: string }
export interface FileTouch { path: string; op: 'create' | 'modify' | 'delete' | 'unknown'; provenance: Provenance }
export interface CommandRun { command: string; exitCode?: number; startedAt?: string; outputTail?: string; kind: 'test' | 'build' | 'lint' | 'git' | 'other' }
export interface Session {
  id: string; agent: AgentKind; files: SessionFileRef[];
  cwd: string; repoRoot?: string; gitBranch?: string; gitCommit?: string;
  agentVersion?: string; model?: string;
  startedAt: string; endedAt: string;
  title: string;                                   // thread name, else first user message (<= 60 chars)
  userMessages: { at: string; text: string }[];    // redacted, max 50, each <= 2000 chars
  finalAssistantText?: string;                     // redacted, <= 2000 chars
  compactionSummaries: string[];                   // codex 'compacted', redacted
  parent?: { kind: 'fork' | 'subagent' | 'split'; sessionId: string };
  usage: Usage; filesTouched: FileTouch[]; commands: CommandRun[];   // commands capped at 200
  state: 'done' | 'open' | 'warn' | 'idle'; stateReasons: string[];
  parse: { ok: boolean; unknownTypes: Record<string, number>; truncatedLines: number; badLines: number };
}
export interface Edge { from: string; to: string; kind: 'fork' | 'subagent' | 'split' | 'shared-file' | 'semantic'; provenance: Provenance; confidence?: number; evidence: string[] }
export interface Lane { id: string; name: string; sessionIds: string[]; usage: Usage; auto: boolean }
export interface ProjectMap { cwd: string; repoRoot?: string; generatedAt: string; sessions: Session[]; lanes: Lane[]; edges: Edge[] }
```
Reader interface: `interface AgentReader { agent: AgentKind; discover(home?: string): Promise<SessionFileRef[]>; parse(ref: SessionFileRef): Promise<Session[]> }` (parse may return several sessions if a file holds copied history; see 02).

## Cache
`~/.tlineage/cache/<hash>.json` per file keyed by (path,size,mtime,parserVersion). `TLINEAGE_HOME` overrides. No native DB.

## Determinism
All ordering ties broken by id. No `Date.now()` inside pure functions (inject `now`). Layout jitter uses FNV-1a hash of session id.

## Config
`~/.tlineage/config.json` and CLI flags: agent home overrides, label count, collapse threshold, redaction extras. Manual overrides per project in `<repoRoot>/.tlineage/overrides.json` (lane rename, move session) are honoured, never auto-written without a user action.
