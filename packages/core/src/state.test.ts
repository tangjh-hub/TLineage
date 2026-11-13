import { expect, test } from "vitest";
import { states } from "./state.js";
import type { CommandRun, Session } from "./types.js";

const now = Date.parse("2020-01-10T00:00:00Z");
const minute = 60_000;
const day = 24 * 60 * minute;
function at(delta: number) {
  return new Date(now - delta).toISOString();
}
const run = (exitCode: number, command = "pnpm test"): CommandRun => ({
  command,
  exitCode,
  kind: "test",
  provenance: "verified",
});
function session(id: string, elapsed: number, options: Partial<Session> = {}) {
  return {
    id,
    startedAt: at(elapsed),
    endedAt: at(elapsed),
    commands: [],
    ...options,
  } as Session;
}

test.each([
  { elapsed: 30 * minute, expected: "open", pending: false, failed: false },
  { elapsed: 30 * minute + 1, expected: "done", pending: false, failed: false },
  { elapsed: 7 * day, expected: "warn", pending: false, failed: true },
  { elapsed: 7 * day + 1, expected: "idle", pending: false, failed: true },
  { elapsed: 8 * day, expected: "idle", pending: true, failed: false },
  { elapsed: day, expected: "open", pending: true, failed: true },
])(
  "infers $expected at $elapsed milliseconds",
  ({ elapsed, pending, failed, expected }) => {
    const [classified] = states(
      [
        session("a", elapsed, {
          pendingLastToolCall: pending,
          commands: failed ? [run(2)] : [],
        }),
      ],
      now,
    );
    expect(classified).toMatchObject({
      state: expected,
      stateProvenance: "inferred",
    });
    expect(classified.stateReasons.length).toBeGreaterThan(0);
  },
);

test("a later success for the same command clears a warning, but a different command does not", () => {
  const first = session("a", 2 * day, { commands: [run(2)] });
  expect(
    states([session("b", day, { commands: [run(0)] }), first], now)[0].state,
  ).toBe("done");
  expect(
    states(
      [first, session("b", day, { commands: [run(0, "pnpm test other")] })],
      now,
    )[0].state,
  ).toBe("warn");
});

test("a recent lane member prevents an older warning from becoming idle", () => {
  const [first] = states(
    [session("b", day), session("a", 8 * day, { commands: [run(1)] })],
    now,
  );
  expect(first.state).toBe("warn");
});
