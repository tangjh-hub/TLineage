import { createDiskCache } from "./disk-cache.js";
import { zstdCapability } from "../../core/src/zstd.js";
import { stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { CodexReader, codexHome } from "../../core/src/codex.js";
import { createScanMemory, scanCodex } from "../../core/src/scan.js";

type Result = Awaited<ReturnType<typeof scanCodex>>;

export function createScanCache(
  requestedHome?: string,
  scan = scanCodex,
  signal?: AbortSignal,
  diskEnabled = false,
) {
  const home = resolve(requestedHome ?? codexHome());
  const disk = diskEnabled
    ? createDiskCache(home, JSON.stringify([null, zstdCapability()]))
    : undefined;
  const reader = new CodexReader();
  const memory = createScanMemory();
  const titlePath = join(home, "session_index.jsonl");
  let saved: { key: string; result: Result } | undefined;
  let generation = 0;
  let pending: { key: string; result: Promise<Result> } | undefined;

  async function fingerprint() {
    signal?.throwIfAborted();
    const files = await reader.discover(home);
    const titles = await stat(titlePath).catch((error: unknown) => {
      if (error instanceof Error && "code" in error && error.code === "ENOENT")
        return;
      throw error;
    });
    return JSON.stringify([
      ...files.map(({ path, sizeBytes, mtimeMs }) => [
        path,
        sizeBytes,
        mtimeMs,
      ]),
      titles ? [titlePath, titles.size, titles.mtimeMs] : null,
    ]);
  }

  return async (repoRoot?: string) => {
    const fingerprintKey = await fingerprint();
    const key = JSON.stringify([repoRoot, fingerprintKey]);
    if (saved?.key === key) return saved.result;
    if (pending?.key === key) return pending.result;
    const current = ++generation;
    const result = (async () => {
      const batch = disk?.batch();
      const snapshot = await scan({
        home,
        cache: diskEnabled ? "read-only" : false,
        sessionCache: batch,
        memory,
        repoRoot,
        signal,
      });
      await batch?.flush();
      if ((await fingerprint()) === fingerprintKey && generation === current)
        saved = { key, result: snapshot };
      return snapshot;
    })();
    pending = { key, result };
    try {
      return await result;
    } finally {
      if (pending?.result === result) pending = undefined;
    }
  };
}
