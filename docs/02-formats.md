# 02 Session formats

This file records the original format hypotheses and current reader rules. Use [observed formats](formats.generated.md) for local evidence. Claude Code support is experimental and unverified, scheduled for M1b when real samples are available.

## Codex CLI
- H Files: `~/.codex/sessions/YYYY/MM/DD/rollout-<timestamp>-<thread-id>.jsonl`. M Some may be `.jsonl.zst`. Check also for an archive folder.
- H Each line is JSON with a timestamp, a `type` and a `payload`. Types reported: `session_meta` (first line), `turn_context`, `response_item`, `event_msg`, `compacted`, plus token-usage records.
- H `session_meta` holds session id, cwd, CLI version and git info. M It also holds source/thread-source info. **Forked** sessions record the parent as `forked_from_id`; sub-agent sessions record `parent_thread_id`. H A forked file contains copied older `session_meta` lines: only the first line identifies the file's own session.
- M One thread can span two files. M `compacted` records may contain huge base64 images; single files of GBs exist, so lines can be megabytes long.
- M `response_item` carries user/assistant messages, reasoning, tool calls and command output. M `event_msg` carries token counts, task start/end, completed items.
- M File changes: newer versions emit a file-change item; older ones use apply_patch calls. Edits made by shell commands are not recorded as file changes.
- M Other files: `session_index.jsonl` (thread names), `history.jsonl` (prompts), `state_5.sqlite` (resume list; version-suffixed; **never write, do not depend on it**).

## Claude Code
- H Files: `~/.claude/projects/<encoded-cwd>/<session-id>.jsonl`. The encoded folder name replaces every non-alphanumeric character with `-` (long paths are truncated with a hash), so it is **lossy**: read `cwd` from the lines, never decode the folder name.
- H Lines carry `type`, `uuid`, `parentUuid`, `sessionId`, `timestamp`, `cwd`, `gitBranch`, `version`, `isSidechain`, and for messages `message{role, model, content[], usage}`. Content blocks: text, thinking, tool_use, tool_result.
- M Sub-agents live in `<session-id>/subagents/`. Large tool outputs may be stored in a `tool-results` folder. File-history snapshots exist.
- H `~/.claude/history.jsonl` holds prompts. H Default retention is 30 days (`cleanupPeriodDays`): old sessions are silently deleted.
- H The format is internal and changes between versions. Documented stable entry points: `/export`, `claude -p --resume <id> --output-format json`, hook `transcript_path`.
- Config dir may be overridden by `CLAUDE_CONFIG_DIR` (verify). Codex home by `CODEX_HOME` (verify).

## Parser requirements
1. Streaming line reader with `maxLineBytes` (default 4 MiB). For longer lines keep the first 64 KiB, extract `type` from the prefix, count `truncatedLines`, skip the body. Memory stays under 300 MB whatever the file size.
2. Zstandard is a primary input format. Use the native Node decoder when available and `fzstd` as the optional pure-JS fallback. `doctor` counts each compressed file that could not be read if neither decoder is available. Validate a 32 MiB frame window before allocation.
3. Tolerate CRLF, a partial last line (active session), BOM, and unknown types (count in `parse.unknownTypes`).
4. The first `session_meta` identifies the file. Prefer the file with the latest last record timestamp when IDs repeat, then the highest line count. Break exact ties by path. Keep the remaining files as alternates outside usage and relationship calculations. Accept multiple prerelease version components. Read `forked_from_id`, top-level `parent_thread_id`, and the older `source.subagent.thread_spawn.parent_thread_id` form.
5. Redact every extracted string (see 07) before it enters `Session`.
6. Support Windows paths and WSL (`\\wsl$`); normalise to forward slashes in the model.
7. Version-aware: record agent version; unknown versions still parse best-effort.
8. Use `token_usage_record` and legacy `event_msg.token_count` as potentially overlapping sources. Sum deduplicated increments and use cumulative snapshots for comparison. Keep fork usage approximate while the inherited baseline remains unverified.
9. Read verified file-change evidence from path-keyed `FileChange.changes` and structured `apply_patch` calls. Prefer `CommandExecution.exit_code`, then a recognized legacy tool output header. Keep missing exit codes unset. See [observed formats](formats.generated.md) for examples.

## Open questions for M0 (answer each with evidence or "not available")
Q1 Exact `session_meta` fields in Codex (id, cwd, git, source, forked_from_id, parent_thread_id) across versions present on this machine.
Q2 Codex token events: location, field names, cumulative vs per-turn; does a forked thread's total include inherited history?
Q3 Codex file-change records: item types for patch/file-change; any exit code field for commands.
Q4 Codex `compacted` record shape; are summaries reusable text?
Q5 Which Codex files are zstd; any archive directory; behaviour when a thread spans two files.
Q6 Claude Code line types present (user, assistant, system, summary, snapshots…); are `message.usage` values repeated across lines of one message (dedupe key `message.id`/`requestId`)?
Q7 Claude Code tool_use names and input keys for file edits and shell commands; `parentUuid` branching semantics; `isSidechain` meaning; sub-agent layout.
Q8 Windows/WSL path behaviour if applicable.
Q9 Syntax and scope flags of `claude mcp add` and `codex mcp add` (from `--help`); skills discovery paths (`~/.claude/skills`, `~/.codex/skills`).
Q10 Node version on this machine and zstd availability; npm name availability.
Q11 Output format of existing handoff tools (TStansel/handoff writes `.agent-handoff/latest.md`; `continues`), if the network is available, to stay compatible.
