import { resolve } from "node:path";
import { expect, test } from "vitest";
import { Evidence } from "./evidence.js";
import { relationships } from "./relationships.js";
import type { Session } from "./types.js";

const start = "2020-01-01T00:00:00.000Z";
const end = "2020-01-01T00:00:01.000Z";
const base = resolve("synthetic-main");
function session(
  id: string,
  paths: string[],
  time = start,
  fields: Partial<Session> = {},
): Session {
  return {
    id,
    cwd: base,
    worktreePath: base,
    startedAt: time,
    endedAt: time,
    parents: [],
    filesTouched: paths.map((path) => ({
      path,
      op: "modify",
      provenance: "verified",
      fileChangeModified: true,
    })),
    ...fields,
  } as Session;
}

test("selects two strongest earlier structured modifications with stable ties", () => {
  const a = session("a", ["src/a.ts", "src/b.ts"]);
  const b = session("b", ["src/b.ts"]);
  const c = session("c", ["src/a.ts"]);
  const sameTime = session("same", ["src/a.ts"], end);
  const checkout = resolve("synthetic-worktree");
  const linked = session("linked", ["src/a.ts"], start, {
    cwd: checkout,
    worktreePath: checkout,
    repoRoot: base,
  });
  const patch = new Evidence();
  patch.response({
    type: "custom_tool_call",
    name: "apply_patch",
    input: "*** Begin Patch\n*** Update File: src/a.ts\n*** End Patch",
  });
  const onlyPatch = session("patch", [], start, {
    filesTouched: patch.snapshot().filesTouched,
  });
  const target = session("target", ["src/a.ts", "src/b.ts"], end, {
    parents: [
      {
        kind: "fork",
        sessionId: "a",
        field: "forked_from_id",
        provenance: "verified",
      },
    ],
  });
  const inputs = [target, c, linked, onlyPatch, a, b, sameTime];
  const edges = relationships(inputs);
  expect(relationships([...inputs].reverse())).toEqual(edges);
  expect(edges.filter((edge) => edge.to === "target")).toEqual([
    {
      from: "a",
      to: "target",
      kind: "fork",
      provenance: "verified",
      evidence: {
        source: "session_meta",
        field: "forked_from_id",
        sessionId: "target",
      },
    },
    {
      from: "a",
      to: "target",
      kind: "shared-file",
      provenance: "verified",
      evidence: { source: "FileChange", files: ["src/a.ts", "src/b.ts"] },
    },
    {
      from: "b",
      to: "target",
      kind: "shared-file",
      provenance: "verified",
      evidence: { source: "FileChange", files: ["src/b.ts"] },
    },
  ]);
});

test("keeps structured update evidence after a later operation on the same path", () => {
  const evidence = new Evidence();
  evidence.item({
    type: "FileChange",
    status: "completed",
    changes: { "a.ts": { type: "update" } },
  });
  evidence.item({
    type: "FileChange",
    status: "completed",
    changes: { "a.ts": { type: "delete" } },
  });
  evidence.item({
    type: "FileChange",
    status: "failed",
    changes: { "b.ts": { type: "update" } },
  });
  expect(evidence.snapshot().filesTouched).toEqual([
    {
      path: "a.ts",
      op: "delete",
      provenance: "verified",
      fileChangeModified: true,
    },
  ]);
});
