# TLineage

[简体中文](README.zh-CN.md)

Browse local Codex history on a standalone session map, see related work, and export a Markdown handoff.

## Quick start

Use Node.js 20 or 22 for this rehearsal. Start in a repository with local Codex history, with the installed CLI on PATH:

```sh
tlineage map --open
tlineage handoff --cwd . --to md
tlineage install codex --dry-run
tlineage install codex
```

The installer previews the Codex MCP and skill changes and asks for confirmation. Use `tlineage uninstall codex` to remove the managed integration. A persistent installation from npm needs a stable global CLI on PATH. The development checkout uses absolute paths, which can break when the checkout or Node executable moves.

This checkout is a private rehearsal. See the [release checklist](docs/RELEASE.md) for how to build and install a local candidate tarball. To view the map without any personal history, run `tlineage map --demo`. See the [demo recording instructions](docs/DEMO.md) for the README animation.

## Scope and privacy

- Codex is the only history source. The Claude Code installer branch is experimental and has not been tested. Markdown can be pasted into other agents. Handoff behavior has been verified with Codex.
- The CLI reads local agent history without modifying it. Runtime analysis is local and has no telemetry. The CLI can write local cache and exports, and the installer can change Codex configuration after confirmation. MCP is read-only and defaults to the startup repository.
- Codex log formats can change. The first scan can take longer than later calls. Platform support beyond verified environments is pending CI results.
- Maps can embed titles, summaries, relative file paths, lane names and handoffs with history excerpts and Git status. `--redact-titles` substitutes short IDs for titles and lane names derived from user messages, removes summaries and omits handoffs. Relative paths and other lane names remain. Inspect maps and handoffs before sharing.
- Redaction covers known secret patterns and conservative assignment matching. It can mask benign values and cannot recognize passwords expressed in natural language.

MCP may keep a redacted copy of parsed session content in `~/.tlineage/cache/mcp`. It can also read existing CLI cache entries. Run `tlineage cache status` to inspect MCP cache usage, `tlineage cache clear` to remove its entries, or start MCP with `tlineage mcp --no-cache` to bypass both disk caches. Redacted content can still be sensitive. Optional installer prewarming requires separate confirmation. Use `tlineage doctor` or `tlineage cache status` for cache diagnostics. Abandoned locks recover on the next write or clear. After checking that no writer is active, use `tlineage cache clear --force-unlock` for a damaged lock.

## Related projects

- [Cairn](https://github.com/CheswickDEV/cairn) documents a local MCP server with handoffs and a decision and evidence ledger.
- [Entire CLI](https://github.com/entireio/cli) captures agent sessions as part of a Git workflow and indexes them alongside commits.
- [Agent History](https://github.com/nihen/ah) provides command-line history browsing and search across agents.
- [Agent Sessions](https://github.com/jazzyalex/agent-sessions) is a macOS session browser with transcript and usage views.
- [session-porter](https://github.com/liwala/session-porter) converts between Claude Code and Codex session formats.

This project focuses on a standalone map of local Codex work by repository and lane, with a Markdown handoff and a local MCP interface.

[Contributing](CONTRIBUTING.md) · [Security](SECURITY.md) · [License](LICENSE)
