import { expect, test } from "vitest";
import { summarizeApproximateUsage } from "./scan.js";

test("counts each reason once per approximate session and keeps the scope denominator", () => {
  expect(
    summarizeApproximateUsage([
      { usage: { quality: "exact", note: "来源不同" } },
      { usage: { quality: "approx", note: "来源不同。 快照回落。来源不同。" } },
      { usage: { quality: "approx", note: "来源不同" } },
      { usage: { quality: "approx", note: " " } },
    ]),
  ).toEqual({
    totalSessions: 4,
    approximateSessions: 3,
    percentOfSessions: 75,
    reasons: [
      { reason: "来源不同", count: 2, percentOfApproximateSessions: 66.67 },
      { reason: "快照回落", count: 1, percentOfApproximateSessions: 33.33 },
      { reason: "未记录原因", count: 1, percentOfApproximateSessions: 33.33 },
    ],
  });
});

test("returns zero percentages for an empty selection", () => {
  expect(summarizeApproximateUsage([])).toEqual({
    totalSessions: 0,
    approximateSessions: 0,
    percentOfSessions: 0,
    reasons: [],
  });
});
