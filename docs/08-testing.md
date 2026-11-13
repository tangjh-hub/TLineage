# 08 Testing

- **Fixtures** (from M0): at least 2 Codex versions and 2 Claude Code versions if present, including a forked session, a sub-agent session, a split thread, a compressed file, a session with a huge line, a session with a failing test run, and a truncated last line.
- **Unit:** each reader on each fixture; unknown types counted; redaction patterns; usage dedupe; lane clustering; edge rules; state heuristics; token estimation.
- **Golden:** same fixture set → byte-identical HTML, Markdown and JSON (snapshot).
- **Property:** redaction never leaks seeded secrets; layout positions are stable across runs; no label overlap among shown labels.
- **Robustness:** random truncation and garbage lines never throw.
- **Perf targets (calibrate in M5):** streaming parse >= 50 MB/s, memory < 300 MB on a 2 GB file, `map` for 500 sessions < 5 s with warm cache.
- **Install tests** run against a temporary HOME; never touch the real one.
- **CI:** `pnpm verify` on Linux, macOS, Windows, Node 20 and 22.
