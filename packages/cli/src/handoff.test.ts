import { expect, test } from "vitest";
import type { buildGraphs, Session } from "../../core/src/index.js";
import { selectHandoff, validateHandoffOptions } from "./handoff.js";

const session = (id: string, endedAt: string): Session =>
  ({
    id,
    title: id,
    startedAt: endedAt,
    endedAt,
    parents: [],
  }) as unknown as Session;
const alpha = session("alpha", "2000-01-02");
const beta = session("beta", "2000-01-03");
const child = {
  ...session("child", "2000-01-01"),
  parents: [{ kind: "subagent", sessionId: "beta", provenance: "verified" }],
} satisfies Session;
const graphs = [
  {
    key: "/fixture",
    repoRoot: "/fixture",
    lanes: [
      { id: "a", name: "same", sessions: [alpha] },
      { id: "b", name: "same", sessions: [beta, child] },
    ],
  },
] as Awaited<ReturnType<typeof buildGraphs>>;

test("selects the latest lane by default and supports explicit session and lane scopes", () => {
  expect(selectHandoff(graphs, {}).sessions).toEqual([beta, child]);
  expect(selectHandoff(graphs, { session: "child" }).sessions).toEqual([beta]);
  expect(selectHandoff(graphs, { lane: "a" }).sessions).toEqual([alpha]);
  expect(() => selectHandoff(graphs, { lane: "same" })).toThrow(/多个匹配/);
  expect(() => selectHandoff(graphs, { session: "missing" })).toThrow(/未找到/);
});

test.each([
  [{ session: "s", lane: "l" }, "互斥"],
  [{ json: true, copy: true }, "互斥"],
  [{ to: "unknown" }, "只接受"],
  [{ format: "agent-handoff" }, "未核实"],
])("rejects incompatible handoff arguments %j", (options, message) => {
  expect(validateHandoffOptions(options)).toContain(message);
});
