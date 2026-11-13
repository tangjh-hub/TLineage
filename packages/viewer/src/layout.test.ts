import { expect, test } from "vitest";
import {
  badges,
  fitLaneLabel,
  clusters,
  foldSubagents,
  hashId,
  jitter,
  labels,
  laneLabels,
  overlap,
  radius,
  timeAxis,
  visibleSessions,
  type Star,
} from "./layout.js";
import type { MapProject, MapSession } from "./types.js";

function session(id: string, fields: Partial<MapSession> = {}): MapSession {
  return {
    id,
    jitter: hashId(id),
    title: id,
    startedAt: "2020-10-21T00:00:00Z",
    endedAt: "2020-10-21T00:00:00Z",
    status: "done",
    lane: "a",
    usage: { total: 100, input: 80, output: 20, approximate: false },
    fileCount: 0,
    files: [],
    ...fields,
  };
}
const day = 86400000;
test.each([
  [day, day, false],
  [3 * day, 3 * day, false],
  [3 * day + 1, day, true],
  [9 * day, day, true],
])("compresses a gap of %d milliseconds to %d", (gap, width, compressed) => {
  const a = new Date("2020-01-01T00:00:00Z").getTime();
  const axis = timeAxis([
    new Date(a + gap).toISOString(),
    new Date(a).toISOString(),
  ]);
  expect(axis.span).toBe(width);
  expect(axis.segments[0].compressed).toBe(compressed);
});

test.each([
  ["a", 3826002220],
  ["session-42", 0],
])("keeps jitter stable for %s", (id, known) => {
  const first = hashId(id);
  if (known) expect(first).toBe(known);
  expect(hashId(id)).toBe(first);
  expect(jitter(first)).toBe((first % 33) - 16);
  expect(jitter(first)).toBeGreaterThanOrEqual(-16);
  expect(jitter(first)).toBeLessThanOrEqual(16);
});

test.each([
  [0, 3],
  [1000, 3],
  [4000, 3.4],
  [1_000_000, 12],
])("clamps the radius of %d tokens", (tokens, expected) => {
  expect(radius(tokens)).toBeCloseTo(expected);
});

const star = (id: string, x: number, y = 90, lane = "a"): Star => ({
  session: session(id, { lane }),
  x,
  y,
  r: 3,
  usage: session(id).usage,
});
test.each([
  [13.99, "a", 1],
  [14, "a", 2],
  [1, "b", 2],
])("clusters at %d px on lane %s", (distance, lane, expected) => {
  const nodes = clusters([star("a", 40), star("b", 40 + distance, 90, lane)]);
  expect(nodes).toHaveLength(expected);
  if (expected === 1)
    expect(
      clusters(
        [star("a", 40), star("b", 40 + distance, 90, lane)],
        new Set([nodes[0].id]),
      ),
    ).toHaveLength(2);
});

test("keeps displayed labels pairwise disjoint and prioritizes the selected star", () => {
  const nodes = clusters(
    Array.from({ length: 16 }, (_, i) =>
      star(String(i), 100 + (i % 4) * 39, 40 + Math.floor(i / 4) * 33),
    ),
  );
  const placed = labels(
    nodes,
    ({ id }) => "session " + id,
    () => 56,
    { x: 0, y: 0, width: 320, height: 240 },
    ["15"],
  );
  expect(placed[0].id).toBe("15");
  expect(placed.length).toBeGreaterThan(1);
  for (let i = 0; i < placed.length; i++) {
    for (let j = i + 1; j < placed.length; j++)
      expect(overlap(placed[i], placed[j])).toBe(false);
  }
});

test.each([false, true])(
  "folds nested subagents without repeating fork contributions (show=%s)",
  (show) => {
    const root = session("root");
    const child = session("child", {
      subagentOf: "root",
      contribution: { total: 30, input: 20, output: 10, approximate: false },
    });
    const nested = session("nested", {
      subagentOf: "child",
      contribution: null,
    });
    const orphan = session("orphan", { subagentOf: "missing" });
    const project: MapProject = {
      label: "fixture",
      lanes: [{ id: "a", name: "a" }],
      sessions: [nested, orphan, root, child],
      edges: [],
    };
    const folded = foldSubagents(project.sessions);
    expect(folded.totals.get("root")).toEqual({
      usage: { total: 130, input: 100, output: 30, approximate: true },
      count: 2,
    });
    expect(
      visibleSessions(project, show, "all", folded).map(({ id }) => id),
    ).toEqual(
      show ? ["child", "nested", "orphan", "root"] : ["orphan", "root"],
    );
  },
);

test("retains malformed parent cycles as ordinary stars", () => {
  const folded = foldSubagents([
    session("a", { subagentOf: "b" }),
    session("b", { subagentOf: "a" }),
  ]);
  expect(folded.parents.size).toBe(0);
});

test.each([false, true])(
  "uses UTC dates and ID-ordered same-day suffixes (reverse=%s)",
  (reverse) => {
    const lanes = [
      { id: "b", name: "src/pages" },
      { id: "a", name: "src/pages" },
      { id: "c", name: "misc" },
      { id: "d", name: "src/pages" },
    ];
    const sessions = [
      session("one", { lane: "a" }),
      session("two", { lane: "b" }),
      session("three", { lane: "c" }),
      session("four", { lane: "d", startedAt: "2020-10-23T01:00:00+08:00" }),
    ];
    const labels = laneLabels({
      label: "fixture",
      lanes: reverse ? lanes.reverse() : lanes,
      sessions,
      edges: [],
    });
    expect(Object.fromEntries(labels)).toEqual({
      a: "src/pages · 10/21 #1",
      b: "src/pages · 10/21 #2",
      c: "misc",
      d: "src/pages · 10/22",
    });
  },
);

test("reserves badge rectangles before placing session titles", () => {
  const nodes = clusters([
    star("a", 70, 95),
    star("b", 95, 90),
    star("c", 135, 88),
  ]);
  const bounds = { x: 0, y: 0, width: 220, height: 160 };
  const measured = (text: string) => text.length * 6;
  const reserved = badges(nodes, () => "+12 agents", measured, bounds, "b");
  expect(reserved).toHaveLength(3);
  const texts = labels(
    nodes,
    ({ id }) => id.repeat(8),
    measured,
    bounds,
    ["a"],
    reserved,
  );
  expect(texts.length).toBeGreaterThan(0);
  const all = [...reserved, ...texts];
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++)
      expect(overlap(all[i], all[j])).toBe(false);
  }
});

test("keeps duplicate dates visible when truncating a lane name", () => {
  const label = fitLaneLabel(
    "payments/webhooks · 10/21 #2",
    22,
    (text) => text.length,
  );
  expect(label.endsWith(" · 10/21 #2")).toBe(true);
  expect(label.length).toBeLessThanOrEqual(22);
});

test("keeps chronological tab order after opening a cluster", () => {
  const first = star("a", 55, 80);
  const middle = star("b", 120, 80);
  const last = star("c", 58, 80);
  const closed = clusters([first, middle, last]);
  const open = clusters([first, middle, last], new Set([closed[0].id]));
  expect(open.map(({ id }) => id)).toEqual(["a", "b", "c"]);
});
