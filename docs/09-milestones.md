# 09 Milestones

Ordered, no dates. Report after each. A milestone is done when every acceptance item passes and `pnpm verify` is green.

## M0 Skeleton and format discovery
Do: monorepo skeleton and `pnpm verify`; inspect real session files on this machine (read-only); answer Q1-Q11; write docs/formats.generated.md (observed fields per version, with sanitized examples); build `scripts/sanitize-fixture`; produce fixtures; start docs/DECISIONS.md.
Accept: every question has an evidence-backed answer or "not available"; fixtures committed and contain no real content; list of places where docs/02 was wrong.

## M1 Codex reader, usage, doctor
Do: bounded streaming JSONL with native zstd and pure-JS fallback, Codex reader, canonical selection and alternates, redaction, deduplicated usage, local cache, `tlineage doctor`, and versioned `tlineage ls --json`. Retain the `AgentReader` interface. Private diagnostic scripts and their output stay outside the repository.
Accept: parse at least 95% of the owner's real Codex files and list the remainder in `doctor`. Keep peak memory below 300 MB on the largest local file, and exercise oversized lines with generated data. Compare three session totals with values supplied by the owner from Codex and document discrepancies.

## M1b Claude Code reader
Status: experimental, unverified. Implement and verify on a machine with real Claude Code sessions. Claude Code remains a valid target for Markdown handoff.

## M2 Lanes, edges, state
Do: cwd/repoRoot grouping, lane clustering, verified edges, state heuristics, overrides file. Initial scope is Codex.
Accept: golden tests on fixtures; on the owner's real repo, lanes are plausible and every edge lists its evidence.

## M3 Viewer
Do: static HTML per docs/05 (star map, tooltips, switcher, detail panel, list view, zoom/pan, keyboard, i18n), `tlineage map`. Initial scope is Codex.
Accept: G2 and G3 on real data (label overlap test passes, clusters appear when dense); works offline; file < 200 KB plus data; deterministic output.

## M4 Handoff
Do: facts collector (git), excerpts, heuristics, template, size cap, preview, copy/out/json, compatibility format. Initial source sessions are Codex. The target can be Codex or Claude Code.
Accept: pack for a real lane is <= 2,000 tokens typically; secrets seeded in a fixture never appear; header and provenance labels present; pasted into Claude Code and Codex, the agent states the right branch and the next step (record transcripts in docs/DECISIONS.md).

## M5 Hardening
Do: perf work to targets, `archive`, Windows/WSL paths, error messages, `doctor` polish.
Accept: perf targets met or revised with reasons; CI green on three OSes.

## M6 MCP, skill, install
Do: MCP server, SKILL.md, `install`/`uninstall` with dry-run, plan/confirm/verify.
Accept: after `tlineage install`, in a fresh Claude Code or Codex session "continue where I stopped" triggers the tool and the agent summarises the lane; `uninstall` restores a clean state; install tests pass on temp HOME.

## M7 Plugins, hooks, serve, share
Do: plugin packages for both agents, hooks (if stable), `serve`, share card, optional summariser behind a flag.
Accept: plugin installs from a local marketplace in both agents; share card contains no paths or messages.

## M8 Release
Do: README (en, zh), demo script and capture recipe for the hero GIF (real repo, redacted), LICENSE, npm publish checklist, issue templates, CONTRIBUTING with "adding an agent reader".
Accept: clean-machine install through `npx` works; README quickstart takes under a minute.
