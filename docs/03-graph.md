# 03 Lanes, edges, state, usage

## Grouping
Group sessions by `cwd` and use the nearest readable Git marker to resolve `repoRoot`. A linked worktree with standard Git metadata resolves through `commondir` to its main checkout and keeps its own checkout path in `worktreePath`. A missing historical directory or a checkout whose shared root cannot be identified keeps its own grouping.

## Lanes (V1, deterministic)
1. Union canonical sessions linked by verified structural edges (fork, subagent).
2. Merge groups when Jaccard similarity is at least 0.5 and the closest session intervals are at most 14 days apart. Compare the sets of the first two directory levels of touched paths inside the checkout (`src/auth/jwt.ts` → `src/auth`, root-level files → `.`). Consider groups in ID order and recompute after each merge.
3. Groups without touched files enter a lane named 杂项 per branch. A verified structural group spanning branches stays together.
4. Use the most frequent depth-two directory prefix as the lane name. For a structural group without a prefix, use up to 20 characters of its first session’s first user message when available. Use lexical order to break prefix-count ties. Overrides take precedence.
5. Order lanes by first session time and sessions by `startedAt`, with IDs as the tie-breaker. An automatic lane ID uses `lane:` followed by its smallest session ID before overrides.

`<repoRoot>/.tlineage/overrides.json` accepts a `rename` object mapping lane IDs to names and a `move` object mapping session IDs to destination lane IDs. Moves refer to the original lanes within the project. The command reads this file and ignores entries with unknown IDs.

## Edges (V1 draws only verified ones)
| kind | rule | provenance |
|---|---|---|
| fork | `forked_from_id` present (Codex) | verified |
| subagent | parent id from Codex session metadata | verified |
| shared-file | B starts strictly after A ends and both have structured `FileChange` updates for the same path in the same checkout. Keep the two highest overlap counts per target, with source ID as the tie-breaker. | verified (evidence lists checkout-relative files) |
Structural edges list the child metadata field. Each edge appears under its target lane. Time order inside a lane is implicit.

Same-ID alternate files are diagnostic references. M1 retains them outside usage and relationship calculations. A split edge needs independently verified evidence in a later milestone.

## Session state
- `open`: ended within 30 minutes of scan time, inclusive, or the last record shows a pending tool call.
- `warn`: otherwise, the last detected test/build command exited non-zero and no later session in the lane successfully re-ran the same recorded command.
- `idle`: lane's newest session is older than 7 days and the session is `open` or `warn`.
- Otherwise use `done`. Emit `stateReasons` and `stateProvenance: inferred`.

## Command classification
Regex on the command string: test (`pytest|vitest|jest|npm test|pnpm test|yarn test|go test|cargo test|mvn test|gradle test`), build, lint, git, other. Keep exit code and the last 40 lines of output (redacted).

## CLI

`tlineage lanes [--cwd <directory>] [--json]` lists the Codex graphs. A directory inside a repository selects that repository, including its linked worktrees. The JSON output uses `schemaVersion: 1` and contains projects, lanes, per-lane usage, sessions, and relationships with evidence. A fixed scan time gives deterministic state calculations.

## Usage
- Codex nodes show `inFile`, the sum of deduplicated increments within the canonical file. Counters include input, output, cache reads and writes, reasoning, and total tokens.
- `baseline` records positive usage from before the file when the first increment and snapshot reconcile with the closing evidence. `threadCumulative` shows the final observed snapshot. Both identify the source and stay separate from the aggregate.
- Source disagreements, rollbacks, ambiguous overlaps, and missing evidence can make the file total approximate. A confirmed opening baseline can explain a difference without lowering the quality.
- Lane usage sums canonical file increments. For a fork with no signature overlap, include its file increments when evidence is sufficient. For a supported sequence match, deduct only counted increments in the child’s matching prefix. Keep unresolved fork usage outside the aggregate and display `≈` when any fork is deferred or any included usage is approximate.
- Claude Code usage remains experimental pending M1b. The UI shows tokens by default.
