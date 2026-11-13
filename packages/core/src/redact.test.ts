import { expect, test } from "vitest";
import { redact } from "./redact.js";

test.each([
  ["sk_live_" + "a".repeat(24), "stripe-key"],
  ["rk_live_" + "b".repeat(24), "stripe-key"],
  ["sk_test_" + "c".repeat(24), "stripe-key"],
  ["rk_test_" + "d".repeat(24), "stripe-key"],
  ["AIza" + "g".repeat(35), "google-api-key"],
  ["npm_" + "n".repeat(36), "npm-token"],
  ["glpat-" + "p".repeat(19) + "-", "gitlab-token"],
  ["SG." + "s".repeat(22) + "." + "x".repeat(43), "sendgrid-key"],
])("redacts a synthetic provider credential as %s", (value, label) => {
  expect(redact(`before (${value}) after`)).toBe(
    `before ([REDACTED:${label}]) after`,
  );
});

test.each([
  "primaryKey: id",
  "sortKey = name",
  "monkey: banana",
  "deploymentkey = short-demo-value",
])("retains the conservative assignment behavior for %s", (assignment) => {
  expect(redact(assignment)).toBe("[REDACTED:assignment]");
});

test("redaction is idempotent across provider keys and contextual rules", () => {
  const input = [
    "Authorization: Bearer " + "npm_" + "n".repeat(36),
    "API_TOKEN=" + "sk_live_" + "a".repeat(24),
    "SG." + "s".repeat(22) + "." + "x".repeat(43),
  ].join("\n");
  const result = redact(input);
  expect(result).not.toBe(input);
  expect(redact(result)).toBe(result);
});

test("handles a 1 MiB near-match without excessive backtracking", () => {
  const input =
    ("x".repeat(56) + "KEYyyyy; ").repeat(16_400) + "\nAPI_TOKEN=synthetic";
  expect(Buffer.byteLength(input)).toBeGreaterThan(1024 * 1024);
  const start = performance.now();
  const result = redact(input);
  expect(performance.now() - start).toBeLessThan(2000);
  expect(result.endsWith("[REDACTED:assignment]")).toBe(true);
});
