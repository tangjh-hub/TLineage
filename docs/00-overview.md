# 00 Overview

## Product
Developers using Codex CLI and Claude Code accumulate many sessions per working directory, lose track of what was done and in what order, and, when one agent's quota runs out, cannot continue in another because context is lost.
TLineage reads the local session files and gives: (1) a **star map** of sessions per working directory with dependency edges and token usage; (2) a **handoff pack** any agent can read to continue; (3) the same data to agents via **MCP** and a **skill**, so an agent can fetch "where did I stop" itself.

## Decisions already made (do not reopen)
1. Go. Star map is the primary visual for everything (main view, usage view, share card).
2. Map first; handoff is the exit from the map. Reuse conventions of existing handoff tools where cheap; do not build session format converters in V1.
3. Token usage is shown on every node and as lane totals. No standalone usage dashboard, trends or budgets.
4. Multi-surface: one core library, thin shells (CLI, HTML, MCP, skill, plugins).
5. V1 supports Codex CLI and Claude Code only. Cursor and others are out of scope.
6. Edges drawn in V1 are verifiable only. Semantic (LLM-inferred) edges come later, always dashed and with confidence.

## Non-goals
Code diff viewer, cloud sync, accounts, billing-accurate cost, automatic quota detection and switching, editing or deleting sessions, writing into agent session stores.

## Glossary
- **Session**: one conversation thread (a thread split across files is one session).
- **Lane** (主线): a cluster of related sessions in one working directory.
- **Edge**: relation between sessions, `verified` or `inferred`.
- **Handoff pack**: a Markdown document that lets another agent continue the work.

## Product gates (the owner judges; you measure what you can)
G1 Parses >= 95% of the owner's real session files without error.
G2 For one real repo the map answers "where did I stop".
G3 The star map stays readable on real data: no overlapping labels among the shown labels; clusters appear when dense.

## Open decisions (ask the owner)
- Final product and npm package name (check availability; `tlineage` is likely taken).
- License (default MIT).
- Whether V1 ships an optional LLM summariser (default: no; see 04-handoff.md).
