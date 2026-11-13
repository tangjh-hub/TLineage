import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as zlib from "node:zlib";
import { afterEach, beforeEach, expect, test } from "vitest";

import { oversizedSessionFrame } from "./fixture-zstd.mjs";

const script = fileURLToPath(new URL("./sanitize-fixture", import.meta.url));
let scratch;

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), "tlineage-sanitizer-test-"));
});

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true });
});

function run(input) {
  return spawnSync(process.execPath, [script, input], { encoding: "utf8" });
}

test("masks free text, unknown keys, real IDs, timestamps, and numbers deterministically", () => {
  const input = join(scratch, "sample.jsonl");
  const id = "original-session-id";
  const timestamp = "2026-10-04T12:34:56.000Z";
  const secret = "sk-fixture-private-value";
  writeFileSync(
    input,
    [
      {
        type: "session_meta",
        timestamp,
        payload: {
          id,
          cwd: "/private/path",
          cli_version: "0.133.0",
          [secret]: secret,
        },
      },
      {
        type: "session_meta",
        timestamp,
        payload: {
          forked_from_id: id,
          account_number: 12345678,
          base_instructions: secret,
        },
      },
    ]
      .map(JSON.stringify)
      .join("\n") + "\n",
  );

  const result = run(input);
  expect(result.status).toBe(0);
  expect(result.stdout).toBe(run(input).stdout);
  for (const raw of [
    id,
    timestamp,
    secret,
    "/private/path",
    "12345678",
    "account_number",
  ]) {
    expect(result.stdout).not.toContain(raw);
  }
  const [parent, child] = result.stdout.trimEnd().split("\n").map(JSON.parse);
  expect(parent.payload.cli_version).toBe("0.133.0");
  expect(parent.payload.id).toBe(child.payload.forked_from_id);
  expect(parent.timestamp).toBe(child.timestamp);
  expect(parent.payload.redacted_key_1).toBe("x".repeat(secret.length));
});

test("masks blobs and preserves the malformed unterminated final line", () => {
  const input = join(scratch, "partial.jsonl");
  const blob = "raw-synthetic-blob".repeat(3000);
  writeFileSync(
    input,
    "\uFEFF" +
      JSON.stringify({ type: "response_item", payload: { output: blob } }) +
      "\r\n" +
      '{"secret": "partial-private',
  );

  const result = run(input);
  expect(result.status).toBe(0);
  expect(result.stdout).toBe(
    '{"type":"response_item","payload":{"output":"[BLOB]"}}\n{"type":"redacted_invalid_line"',
  );
});

test("preserves a nonzero command outcome without keeping command output", () => {
  const input = join(scratch, "failed.jsonl");
  writeFileSync(
    input,
    JSON.stringify({
      type: "response_item",
      payload: {
        type: "function_call_output",
        output:
          "Chunk ID: private-id\nWall time: 3 seconds\nProcess exited with code 17\nOutput:\nprivate-result",
      },
    }),
  );
  const result = run(input);
  expect(result.status).toBe(0);
  expect(result.stdout).not.toContain("private-");
  expect(JSON.parse(result.stdout).payload.output).toContain(
    "Process exited with code 1",
  );
});

test.skipIf(typeof zlib.createZstdDecompress !== "function")(
  "reads the compressed fixture and masks its synthetic oversized blob",
  () => {
    const fixture = join(scratch, "oversized.jsonl.zst");
    writeFileSync(fixture, oversizedSessionFrame());
    const raw = zlib.zstdDecompressSync(readFileSync(fixture));
    expect(raw.length).toBeGreaterThan(4 * 1024 * 1024);
    const result = run(fixture);
    expect(result.status).toBe(0);
    const rows = result.stdout.trimEnd().split("\n").map(JSON.parse);
    expect(rows[0].type).toBe("session_meta");
    expect(rows[1].payload.output).toBe("[BLOB]");
    expect(rows[2].payload.type).toBe("token_count");
  },
);

test("caps text placeholders at 64 characters", () => {
  const input = join(scratch, "length.jsonl");
  writeFileSync(
    input,
    JSON.stringify({
      type: "response_item",
      payload: { text: "s".repeat(201) },
    }),
  );
  const result = run(input);
  expect(result.status).toBe(0);
  expect(JSON.parse(result.stdout).payload.text).toBe("x".repeat(64));
});
