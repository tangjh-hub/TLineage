import {
  mkdir,
  mkdtemp,
  readdir,
  rename,
  rm,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, vi } from "vitest";
import { CodexReader } from "../../core/src/codex.js";
import { scanCodex } from "../../core/src/scan.js";
import { createScanCache } from "./scan-cache.js";

test("keeps one in-memory scan and invalidates on paths, sizes, mtimes and title changes", async () => {
  const home = await mkdtemp(join(tmpdir(), "tlineage-memory-"));
  try {
    const sessions = join(home, "sessions");
    await mkdir(sessions);
    const file = join(sessions, "one.jsonl");
    await writeFile(file, "");
    const scan = vi.fn(scanCodex);
    const load = createScanCache(home, scan);
    const [first, second] = await Promise.all([load(), load()]);
    expect(first).toBe(second);
    expect(scan).toHaveBeenCalledTimes(1);
    await writeFile(file, "\n");
    await load();
    await utimes(file, new Date(1000), new Date(1000));
    await load();
    await rename(file, join(sessions, "two.jsonl"));
    await load();
    await writeFile(join(home, "session_index.jsonl"), "\n");
    await load();
    expect(scan).toHaveBeenCalledTimes(5);
    expect(scan.mock.calls.every(([options]) => options?.cache === false)).toBe(
      true,
    );
    expect((await readdir(home)).sort()).toEqual([
      "session_index.jsonl",
      "sessions",
    ]);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("reuses unchanged session parses when another file changes", async () => {
  const home = await mkdtemp(join(tmpdir(), "tlineage-memory-file-"));
  const read = vi.spyOn(CodexReader.prototype, "scan");
  try {
    const sessions = join(home, "sessions");
    await mkdir(sessions);
    const at = "2000-01-01T00:00:00Z";
    const row = (id: string) =>
      JSON.stringify({
        type: "session_meta",
        timestamp: at,
        payload: { id, cwd: home },
      });
    for (const id of ["first", "second"])
      await writeFile(join(sessions, id + ".jsonl"), row(id));
    const load = createScanCache(home);
    expect((await load()).sessions).toHaveLength(2);
    expect(read).toHaveBeenCalledTimes(2);
    await writeFile(join(sessions, "first.jsonl"), row("updated") + "\n");
    expect((await load()).sessions.map(({ id }) => id)).toEqual([
      "second",
      "updated",
    ]);
    expect(read).toHaveBeenCalledTimes(3);
  } finally {
    read.mockRestore();
    await rm(home, { recursive: true, force: true });
  }
});
