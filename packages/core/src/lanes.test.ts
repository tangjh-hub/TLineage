import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, test } from "vitest";
import { clusterLanes } from "./lanes.js";
import { readOverrides } from "./overrides.js";
import type { Session } from "./types.js";

const base = resolve("synthetic-repo");
function session(
  id: string,
  paths: string[],
  date: string,
  fields: Partial<Session> = {},
): Session {
  return {
    id,
    cwd: base,
    parents: [],
    userMessages: [],
    filesTouched: paths.map((path) => ({
      path,
      op: "modify",
      provenance: "verified",
    })),
    startedAt: date,
    endedAt: date,
    ...fields,
  } as Session;
}
const start = "2020-01-01T00:00:00.000Z";

test.each([
  { date: "2020-01-15T00:00:00.000Z", files: ["src/a/two.ts"], expected: 1 },
  {
    date: "2020-01-15T00:00:00.000000001Z",
    files: ["src/a/two.ts"],
    expected: 2,
  },
  { date: start, files: ["src/a/two.ts", "src/c/two.ts"], expected: 2 },
  { date: start, files: ["src/a/two.ts", "src/b/two.ts"], expected: 1 },
])(
  "clusters a threshold case with $expected lanes",
  ({ date, files, expected }) => {
    const a = session("a", ["src/a/one.ts", "src/b/one.ts"], start);
    const b = session("b", files, date);
    expect(clusterLanes([a, b])).toHaveLength(expected);
    expect(clusterLanes([b, a])).toEqual(clusterLanes([a, b]));
  },
);

test("keeps verified structural links before similarity and splits miscellaneous by branch", () => {
  const a = session("a", ["src/core/a.ts"], start);
  const b = session("b", [], "2020-03-01T00:00:00Z", {
    parents: [{ kind: "fork", sessionId: "a", provenance: "verified" }],
  });
  const c = session("c", [], start, { gitBranch: "main" });
  const d = session("d", [], start, { gitBranch: "main" });
  const e = session("e", [], start, { gitBranch: "other" });
  expect(
    clusterLanes([a, b, c, d, e]).map(({ name, sessions }) => [
      name,
      sessions.map((s) => s.id),
    ]),
  ).toEqual([
    ["src/core", ["a", "b"]],
    ["杂项", ["c", "d"]],
    ["杂项", ["e"]],
  ]);
});

test("reads renames and applies moves using original lane IDs", async () => {
  const temp = await mkdtemp(join(tmpdir(), "tlineage-overrides-"));
  try {
    const directory = join(temp, ".tlineage");
    await mkdir(directory);
    await writeFile(
      join(directory, "overrides.json"),
      JSON.stringify({
        rename: { "lane:b": "合并主线" },
        move: { a: "lane:b", b: "missing" },
      }),
    );
    const a = session("a", ["src/core/a.ts"], start);
    const b = session("b", ["docs/guide/b.md"], start);
    const lanes = clusterLanes([b, a], await readOverrides(temp));
    expect(
      lanes.map(({ id, name, sessions }) => [
        id,
        name,
        sessions.map((s) => s.id),
      ]),
    ).toEqual([["lane:b", "合并主线", ["a", "b"]]]);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
