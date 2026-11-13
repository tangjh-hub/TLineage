import { expect, test } from "vitest";
import { handoffContent } from "./handoff-content.js";
import type { Session } from "./types.js";

function session(id: string, overrides: Partial<Session> = {}): Session {
  return {
    id,
    agent: "codex",
    title: id,
    parents: [],
    userMessages: [],
    startedAt: "2000-01-01",
    endedAt: "2000-01-02",
    commands: [],
    filesTouched: [],
    cwd: "/fixture",
    parse: { ok: true },
    compactionSummaries: ["private compact fixture"],
    ...overrides,
  } as Session;
}

test("separates excerpts and inferred findings and counts nested subagents", () => {
  const root = session("root", {
    userMessages: [
      {
        at: "2000-01-01",
        text: "必须先跑测试。\n请确认提交。\n确认继续。\nTODO: refine output.",
      },
    ],
    finalAssistantText: "Should we verify the fixture?",
  });
  const parent = (sessionId: string) => [
    { kind: "subagent" as const, sessionId, provenance: "verified" as const },
  ];
  const child = session("child", { parents: parent("root") });
  const nested = session("nested", { parents: parent("child") });
  const sections = new Map(
    handoffContent([root], [root, child, nested]).map((section) => [
      section.id,
      section,
    ]),
  );
  expect(sections.get("done")?.items).toEqual([
    {
      text: "root (+2 subagents)\nShould we verify the fixture?",
      source: "root",
    },
  ]);
  expect(sections.get("goal")?.provenance).toBe("excerpt");
  expect(sections.has("constraints")).toBe(false);
  expect(sections.get("approvals")?.items.map(({ text }) => text)).toEqual([
    expect.stringContaining("Pending in history"),
    expect.stringContaining("scope requires verification"),
  ]);
  expect(sections.get("open")?.items).toHaveLength(2);
  expect(JSON.stringify([...sections])).not.toMatch(
    /private compact fixture|"source":"(?:child|nested)"/,
  );
});

test("uses only structured command details and never guesses a missing exit code", () => {
  const root = session("root", {
    commands: [
      {
        command: "pnpm test",
        kind: "test",
        provenance: "verified",
        exitCode: 1,
        structured: { exitCode: 1, outputTail: "failure" },
      },
      {
        command: "pnpm build",
        kind: "build",
        provenance: "verified",
        exitCode: 9,
        outputTail: "legacy",
        structured: {},
      },
      {
        command: "npm test",
        kind: "test",
        provenance: "verified",
        startedAt: "2000-01-03",
        exitCode: 1,
      },
    ],
  });
  const rows = handoffContent([root]);
  expect(rows.find(({ id }) => id === "tests")?.items[0].text).toBe(
    "pnpm build",
  );
  expect(rows.find(({ id }) => id === "gaps")?.items[0].text).toContain(
    "no structured exit code",
  );
  expect(rows.find(({ id }) => id === "open")?.items[0].text).toContain(
    "pnpm test",
  );
});

test("keeps at most five inferred items newest first and breaks time ties by session ID", () => {
  const goal = "Only preserve the fixture.";
  const make = (id: string, at: string) =>
    session(id, {
      startedAt: "2000-01-01",
      endedAt: at || "2000-01-06",
      userMessages: [
        { at: "2000-01-01", text: goal },
        { at, text: `Only update ${id}.\n确认 ${id}。\nTODO: review ${id}.` },
      ],
    });
  const input = [
    make("z", "2000-01-05"),
    make("a", "2000-01-05"),
    make("f", ""),
    make("x", "2000-01-04"),
    make("b", "2000-01-03"),
    make("c", "2000-01-02"),
  ];
  const rows = handoffContent(input);
  expect(handoffContent([...input].reverse())).toEqual(rows);
  expect(rows.find(({ id }) => id === "goal")?.items[0].text).toBe(goal);
  const constraints = rows.find(({ id }) => id === "constraints")!.items;
  expect(constraints.map(({ text }) => text)).toEqual(
    ["f", "a", "z", "x", "b"].map((id) => `Only update ${id}.`),
  );
  for (const id of ["open", "approvals"] as const)
    expect(rows.find((section) => section.id === id)?.items).toHaveLength(5);
  expect(rows.findIndex(({ id }) => id === "open")).toBeLessThan(
    rows.findIndex(({ id }) => id === "constraints"),
  );
});

test.each([
  ["Only update tests.\nNever touch production.", "Never touch production."],
  ["Only update tests.", "Only update tests."],
  ["Goal: only update tests.", "only update tests."],
  ["Only update tests.", "Only update tests. Use a fixture"],
])(
  "deduplicates goal constraints while preserving a distinct message",
  (goal, repeated) => {
    const first = session("goal", {
      startedAt: "2000-01-01",
      userMessages: [{ at: "2000-01-01", text: goal }],
    });
    const other = session("later", {
      startedAt: "2000-01-02",
      userMessages: [
        { at: "2000-01-01", text: repeated },
        { at: "2000-01-01", text: "Never commit the fixture." },
      ],
    });
    const rows = handoffContent([other, first]);
    expect(rows.find(({ id }) => id === "goal")?.items[0].text).toBe(goal);
    expect(
      rows
        .find(({ id }) => id === "constraints")
        ?.items.map(({ text }) => text),
    ).toEqual(["Never commit the fixture."]);
  },
);
