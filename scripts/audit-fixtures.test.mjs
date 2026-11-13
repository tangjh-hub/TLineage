import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";

test("owner approval is limited to the recorded category and field", () => {
  const root = mkdtempSync(join(tmpdir(), "tlineage-audit-test-"));
  try {
    for (const dir of ["scripts", "docs", "fixtures"])
      mkdirSync(join(root, dir));
    const script = join(root, "scripts", "audit-fixtures.mjs");
    writeFileSync(
      script,
      readFileSync(new URL("./audit-fixtures", import.meta.url)),
    );
    writeFileSync(join(root, "docs/formats.generated.md"), "`source` `role`");
    writeFileSync(
      join(root, "fixtures/vocabulary.json"),
      JSON.stringify([
        {
          string: "reviewed-value",
          category: "value",
          field: "source",
          reviewer: "owner",
          reviewedAt: "2026-11-13",
        },
      ]),
    );
    const sample = join(root, "fixtures/sample.jsonl");
    const run = (data) => {
      writeFileSync(sample, JSON.stringify(data));
      const result = spawnSync(process.execPath, [script], {
        encoding: "utf8",
        env: { ...process.env, TMPDIR: root, TEMP: root, TMP: root },
      });
      return {
        status: result.status,
        counts: JSON.parse(result.stdout.split("\n")[0]),
      };
    };
    expect(run({ source: "reviewed-value" })).toMatchObject({
      status: 0,
      counts: { d: 0, ownerReviewed: 1 },
    });
    expect(run({ role: "reviewed-value" })).toMatchObject({
      status: 1,
      counts: { d: 1 },
    });
    expect(run({ "reviewed-value": "x" })).toMatchObject({
      status: 1,
      counts: { d: 1 },
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
