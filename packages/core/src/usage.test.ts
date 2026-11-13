import { expect, test } from "vitest";
import { canonicalSessions } from "./canonical.js";
import type { Session } from "./types.js";
import { tokenRecordSignature, totalUsage, UsageAccumulator } from "./usage.js";

type Counter = {
  total_tokens: number;
  input_tokens?: number;
  output_tokens?: number;
};
type Event =
  | { source: "turn"; id: string }
  | { source: "legacy"; delta?: Counter; cumulative?: Counter }
  | {
      source: "record";
      turnId: string;
      responseId: string;
      delta: Counter;
      cumulative: Counter;
    };

const counter = (total_tokens: number): Counter => ({ total_tokens });
const measured = (input_tokens: number, output_tokens: number): Counter => ({
  input_tokens,
  output_tokens,
  total_tokens: input_tokens + output_tokens,
});
const turn = (id: string): Event => ({ source: "turn", id });
const legacy = (
  delta: number | Counter,
  cumulative: number | Counter,
): Event => ({
  source: "legacy",
  delta: typeof delta === "number" ? counter(delta) : delta,
  cumulative: typeof cumulative === "number" ? counter(cumulative) : cumulative,
});
const record = (
  turnId: string,
  responseId: string,
  delta: number | Counter,
  cumulative: number | Counter,
): Event => ({
  source: "record",
  turnId,
  responseId,
  delta: typeof delta === "number" ? counter(delta) : delta,
  cumulative: typeof cumulative === "number" ? counter(cumulative) : cumulative,
});
const prefixSignature = tokenRecordSignature("token_usage_record", {
  usage: counter(3),
  thread_token_usage: counter(3),
})!;

const cases: {
  name: string;
  events: Event[];
  expected: Record<string, unknown>;
  notes?: string[];
  noBaseline?: boolean;
  noCumulative?: boolean;
  fork?: boolean;
  forkPrefix?: ReadonlySet<string>;
  aggregate?: number;
}[] = [
  {
    name: "two sources in either order deduplicate while equal deltas from distinct responses count",
    events: [
      turn("a"),
      legacy(measured(6, 1), measured(6, 1)),
      legacy(measured(6, 1), measured(6, 1)),
      record("a", "first", measured(6, 1), measured(6, 1)),
      record("a", "first", measured(6, 1), measured(6, 1)),
      record("a", "second", measured(6, 1), measured(12, 2)),
      legacy(measured(6, 1), measured(12, 2)),
    ],
    expected: {
      input: 12,
      output: 2,
      total: 14,
      quality: "exact",
      threadCumulative: { total: 14, source: "token_count" },
    },
  },
  {
    name: "snapshot rollback retains increments and marks usage approximate",
    events: [turn("a"), legacy(9, 9), turn("b"), legacy(6, 6)],
    expected: { total: 15, quality: "approx" },
    notes: ["回落", "不一致"],
  },
  {
    name: "fork without matching evidence retains node usage and excludes it from aggregates",
    events: [record("a", "first", measured(4, 1), measured(104, 1))],
    expected: { total: 5, quality: "approx" },
    fork: true,
    aggregate: 0,
    notes: ["重叠证据不足"],
  },
  {
    name: "snapshot without an increment does not invent file usage",
    events: [{ source: "legacy", cumulative: counter(100) }],
    expected: { total: 0, quality: "approx", threadCumulative: { total: 100 } },
    noBaseline: true,
  },
  {
    name: "increment without a snapshot is retained with approximate quality",
    events: [{ source: "legacy", delta: counter(5) }],
    expected: { total: 5, quality: "approx" },
    noBaseline: true,
    noCumulative: true,
  },
  {
    name: "disjoint legacy usage is added and overlapping legacy usage is rejected",
    events: [
      turn("a"),
      legacy(10, 10),
      record("a", "first", 10, 20),
      legacy(8, 20),
    ],
    expected: { total: 20, quality: "approx" },
    notes: ["重叠"],
  },
  {
    name: "sample 2 retains aligned modern usage when source totals differ",
    events: [
      record("a", "first", 100, 100),
      legacy(100, 100),
      record("b", "second", 50, 150),
      legacy(10, 100),
    ],
    expected: {
      total: 150,
      quality: "approx",
      threadCumulative: { total: 100, source: "token_count" },
    },
    notes: ["采用已对齐的新式增量"],
    noBaseline: true,
  },
  {
    name: "sample 1 reconciles with a confirmed opening baseline",
    events: [
      record("a", "first", 3, 13),
      legacy(3, 13),
      record("b", "second", 2, 15),
      legacy(2, 15),
    ],
    expected: {
      scope: "inFile",
      total: 5,
      quality: "exact",
      baseline: {
        total: 10,
        source: "token_usage_record",
        provenance: "inferred",
      },
      threadCumulative: {
        total: 15,
        source: "token_count",
        provenance: "verified",
      },
    },
    aggregate: 5,
  },
  {
    name: "sample 3 counts a single shared increment once",
    events: [record("a", "first", 7, 7), legacy(7, 7)],
    expected: { total: 7, quality: "exact", threadCumulative: { total: 7 } },
    noBaseline: true,
  },
  {
    name: "apparent baseline stays unset when it cannot explain the closing snapshot",
    events: [legacy(3, 13), legacy(2, 18)],
    expected: { total: 5, quality: "approx", threadCumulative: { total: 18 } },
    noBaseline: true,
  },
  {
    name: "fork prefix is deducted once after deduplication",
    events: [
      record("a", "first", 3, 3),
      legacy(3, 3),
      record("b", "second", 2, 5),
      legacy(2, 5),
    ],
    expected: { total: 5, quality: "exact" },
    fork: true,
    forkPrefix: new Set([prefixSignature]),
    aggregate: 2,
  },
];

test.each(cases)(
  "$name",
  ({
    events,
    expected,
    notes,
    noBaseline,
    noCumulative,
    fork,
    forkPrefix,
    aggregate,
  }) => {
    const accumulator = new UsageAccumulator(forkPrefix);
    for (const event of events) {
      if (event.source === "turn") accumulator.startTurn(event.id);
      else if (event.source === "legacy") {
        accumulator.legacy({
          last_token_usage: event.delta,
          total_token_usage: event.cumulative,
        });
      } else {
        accumulator.record({
          turn_id: event.turnId,
          response_id: event.responseId,
          usage: event.delta,
          thread_token_usage: event.cumulative,
        });
      }
    }
    const result = accumulator.finish(fork ?? false);
    expect(result).toMatchObject(expected);
    for (const note of notes ?? []) expect(result.note).toContain(note);
    if (noBaseline) expect(result.baseline).toBeUndefined();
    if (noCumulative) expect(result.threadCumulative).toBeUndefined();
    if (aggregate !== undefined) {
      const session = {
        usage: result,
        parent: fork ? { kind: "fork" } : undefined,
        forkAggregate: accumulator.forkAggregate,
      } as Session;
      expect(totalUsage([session]).total).toBe(aggregate);
      if (fork && !forkPrefix)
        expect(totalUsage([session]).quality).toBe("approx");
    }
    if (forkPrefix)
      expect(accumulator.forkAggregate?.excludedSignatures).toBe(1);
  },
);

test.each([
  {
    name: "later timestamp",
    earlierAt: "2026-01-01T00:00:00Z",
    earlierLines: 10,
  },
  {
    name: "more lines at the same timestamp",
    earlierAt: "2026-01-02T00:00:00Z",
    earlierLines: 1,
  },
])(
  "same ID uses only the canonical file selected by $name",
  ({ earlierAt, earlierLines }) => {
    function session(
      path: string,
      at: string,
      lineCount: number,
      amount: number,
    ) {
      const accumulator = new UsageAccumulator();
      accumulator.legacy({
        last_token_usage: counter(amount),
        total_token_usage: counter(amount),
      });
      return {
        agent: "codex",
        id: "same",
        files: [{ path }],
        parse: { lastRecordAt: at, lineCount },
        usage: accumulator.finish(false),
      } as Session;
    }
    const alternate = session("alternate.jsonl", earlierAt, earlierLines, 100);
    const canonical = session("canonical.jsonl", "2026-01-02T00:00:00Z", 2, 7);
    const selected = canonicalSessions([alternate, canonical]);
    expect(selected).toHaveLength(1);
    expect(selected[0].alternates).toEqual(alternate.files);
    expect(totalUsage(selected)).toMatchObject({ total: 7, quality: "exact" });
  },
);
