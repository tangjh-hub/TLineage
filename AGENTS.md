# AGENTS.md — TLineage

TLineage reads local coding-agent sessions (Codex CLI, Claude Code), builds a per-working-directory "star map" of sessions with dependencies and token usage, and produces handoff packs so another agent can continue the work. Surfaces: CLI, static HTML map, MCP server, skill, plugin packages. "TLineage" is the product name; keep it in one constant (`PRODUCT_NAME`).

## Read first
docs/00-overview.md → 01-architecture.md → 02-formats.md → 09-milestones.md, then the doc for the milestone you are on.

## Working rules
1. **Start with M0.** Real data on this machine beats docs/02-formats.md. When they conflict, trust the data, and record it in docs/formats.generated.md and docs/DECISIONS.md.
2. One milestone at a time. A milestone is done only when its acceptance criteria (docs/09-milestones.md) pass and `pnpm verify` is green (typecheck, lint, test, build).
3. **Read-only toward agent data.** Never write, move or delete anything under ~/.codex or ~/.claude (or CODEX_HOME / CLAUDE_CONFIG_DIR). Only `tlineage install`/`uninstall` may touch agent config, after a preview and explicit confirmation.
4. **Privacy.** Never commit real session content. Fixtures must pass through `scripts/sanitize-fixture`. No network calls, no telemetry, no LLM calls unless a flag explicitly enables them.
5. **Tolerant parsing.** Unknown line types or fields are counted and skipped, never thrown. Never load a whole session file into memory.
6. Do not invent fields. Every derived value carries `provenance: 'verified' | 'inferred'`.
7. Ask the owner only about items under "Open decisions" in docs/00-overview.md. Decide everything else yourself and log it in docs/DECISIONS.md.

## Stack
TypeScript (strict, ESM), Node >= 20, pnpm workspaces, tsup, Vitest, ESLint + Prettier. No native dependencies (must work via `npx`).

## Commands to create
`pnpm verify` · `pnpm test` · `pnpm build` · `pnpm tlineage -- <args>`

## Style
No `any`. Pure functions in core, IO at the edges. Deterministic output: same input gives byte-identical HTML/Markdown. Small commits, one concern each.
