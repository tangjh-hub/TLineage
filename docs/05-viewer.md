# 05 Viewer (static HTML star map)

Reference visuals: `design/app-screen.html` (full screen) and `design/star-map.html` (map only). Match structure, spacing and tokens; do not copy the hand-placed coordinates.

## Output
One self-contained `.html` file: inline CSS/JS, embedded JSON, no network requests, no web fonts (stack: `Inter, system-ui, 'PingFang SC', 'Noto Sans SC', sans-serif`; mono: `'JetBrains Mono', ui-monospace, Menlo, monospace`). Vanilla TypeScript compiled by tsup/esbuild, target < 200 KB excluding data. `tlineage map --all` bakes every working directory so the switcher works offline. M3 reads Codex sessions and produces an offline snapshot.
UI language follows `navigator.language` (zh / en). All strings are in one i18n table. Use `--lang zh|en` to set the language explicitly.

`tlineage map [--cwd <dir>] [--all] [--out <file>] [--open] [--lang zh|en] [--redact-titles]` writes to the `maps` directory under `TLINEAGE_HOME` by default and prints the path. The fallback home is `~/.tlineage`. Run `tlineage map --demo` to generate a page labelled Example data from synthetic sessions.

The embedded data includes titles, bounded redacted excerpts, relative file names and relationship evidence needed by the UI. `--redact-titles` substitutes short IDs for titles and message-derived lane names and omits excerpts. Relative file paths and other lane names remain. The CLI help and page footer list the fields included in the HTML. A stricter sharing mode is planned for M7.

## Layout
Left sidebar 216px (logo, working-directory switcher, Map navigation, stats). Centre: header with filters (All / Active / Stalled / Done), star map card, legend. Right panel 380px: selected session or lane.

## Design tokens
bg `#0B0B0C` · map bg `#07080D` · panel `#0D0D0F` / `#111113` · border `#232327` · text `#ECECEE` · muted `#8E8E93` (min contrast 4.5:1) · accent (UI only) `#7CE3C0` · warn `#E8B36A`.
Lane palette: `#8FB4FF #FF9D80 #C3A6FF #6FC9D8 #F29FC2 #B7D98B #9AA0AA` (accent and warn are never lane colours).
Type: 20 title, 13 body, 11 captions. Radius 8-14. No shadows, no gradients except star glow.

## Star map layout
- **x = time.** Piecewise linear over session start times; any gap > 3 days is compressed to the width of 1 day and marked on the axis with a break glyph. Axis labels at nice ticks.
- **y = lane band.** Band height 90 units; lanes in order of first activity. Jitter within the band: `dy = (fnv1a(id) % 33 - 16)` units, so positions are stable between runs.
- **size = usage.** `R = clamp(2.5 + sqrt(tokensK) * 0.45, 3, 12)`. Glow: blurred circle `2.2R`, opacity .35 (SVG `feGaussianBlur` stdDeviation 4).
- **state:** done = solid white core with lane-colour stroke; open = hollow (core = bg) with 2px stroke; warn = amber; idle = 50% opacity; selected = extra ring `R+8`, colour `#ECECEE`.
- **edges:** lane polyline in lane colour, 1px, opacity .55. Verified cross-lane edges: solid `#ECECEE`, 1.2px, opacity .45. Inferred edges are reserved for later milestones.
- **subagents:** fold into the nearest visible ancestor by default. A parent badge shows the number folded. A session with no available parent remains visible. The Show subagents toggle renders the individual sessions. Parent aggregates apply the M2 fork contribution rules to each descendant once.
- **lane names:** duplicate labels append the first session date in UTC (`MM/DD`). Same-day ties append `#n` in lane ID order.
- **labels:** show for selected, hovered and the top-K nodes by usage (K=12). Greedy placement by priority with bounding-box collision avoidance; hidden labels appear as zoom grows.
- **clusters:** within a lane, stars closer than 14 px merge into a cluster star with a count badge; click expands. Applies after zoom is considered.
- **zoom/pan:** ctrl+wheel and pinch to zoom, drag to pan, `0` resets.
- **start-up view:** fit all, selection = newest `open` or `warn` session, else newest.
- **Accessibility:** never colour alone (band position, text labels, shape). Each star is a focusable element with `role="button"` and an `aria-label` (title, agent, date, tokens). Arrow keys move between neighbours; Tab follows time order; tooltip shows on focus too. A **list view** (toggle) shows the same sessions in a table; it is also the fallback when the map would exceed 500 stars.

## Tooltip (hover/focus)
Title · `Agent · date · N files` · a redacted excerpt of up to 40 characters when available · own in-file usage and usage including any folded subagents. Approximate values show "≈". Sessions with a baseline show the thread cumulative value on a separate line.

## Right panel
Status chip + `Agent · date · lane`, title, one-line summary, usage line (input/output), touched files (max 5, "+N"), relations (from/to, with provenance), then the **Handoff card** with target tabs, editable preview and a copy button. Normal maps include a redacted export-time pack per lane. A map generated with `--redact-titles` omits handoff packs.

## Chinese UI copy (default zh)
项目地图 · 工作目录 · 全部 / 进行中 / 搁置 / 已完成 · 触及文件 · 关系 · 用量 · 换 agent 接着干 · 复制接力包 · 星体大小 = token 用量 · 实线 = 可验证 · 虚线 = 推断 · 需要关注 · 示例数据 (only in demo mode).

## Share card (M7)
Export the same SVG as SVG/PNG after a stricter redaction: shapes, lane names and session titles only; no paths, code, messages or hashes. `--share` shows what will be included before writing.
