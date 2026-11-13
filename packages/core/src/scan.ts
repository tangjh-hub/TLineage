import { selectSessionFiles } from "./scan-scope.js";
import { canonicalSessions } from "./canonical.js";
import { SessionCache } from "./cache.js";
import { CodexReader, codexHome } from "./codex.js";
import { safePath } from "./evidence.js";
import { forkPrefix, readForkSignatures, sameFile } from "./fork.js";
import type { ReadOptions } from "./lines.js";
import type { Session, SessionFileRef, Usage } from "./types.js";
import { totalUsage } from "./usage.js";
import { zstdCapability } from "./zstd.js";

export interface ScanOptions extends ReadOptions {
  home?: string;
  cache?: boolean | "read-only";
  sessionCache?: Pick<SessionCache, "read" | "write">;
  cacheHome?: string;
  repoRoot?: string;
  memory?: ReturnType<typeof createScanMemory>;
}

export function createScanMemory() {
  function memo<T>() {
    const entries = new Map<
      string,
      { signature: string; result: Promise<T> }
    >();
    return {
      read(ref: SessionFileRef, variant: string, load: () => Promise<T>) {
        const signature = JSON.stringify([ref.sizeBytes, ref.mtimeMs, variant]);
        const found = entries.get(ref.path);
        if (found?.signature === signature) return found.result;
        const entry = { signature, result: load() };
        entries.set(ref.path, entry);
        const forget = () => {
          if (entries.get(ref.path) === entry) entries.delete(ref.path);
        };
        void entry.result.then(async () => {
          if (!(await sameFile(ref))) forget();
        }, forget);
        return entry.result;
      },
      retain(paths: Set<string>) {
        for (const path of entries.keys())
          if (!paths.has(path)) entries.delete(path);
      },
    };
  }
  const headers = memo<Awaited<ReturnType<CodexReader["metadata"]>>>();
  const sessions = memo<Awaited<ReturnType<CodexReader["scan"]>>>();
  const signatures = memo<Awaited<ReturnType<typeof readForkSignatures>>>();
  const forks = memo<Awaited<ReturnType<CodexReader["scan"]>>>();
  return {
    headers,
    sessions,
    signatures,
    forks,
    retain(files: readonly SessionFileRef[]) {
      const paths = new Set(files.map(({ path }) => path));
      for (const store of [headers, sessions, signatures, forks])
        store.retain(paths);
    },
  };
}

const top = (counts: Map<string, number>, limit = 10) =>
  [...counts.entries()]
    .sort(
      ([a, left], [b, right]) => right - left || (a < b ? -1 : a > b ? 1 : 0),
    )
    .slice(0, limit)
    .map(([type, count]) => ({ type, count }));

function merge(target: Map<string, number>, counts: Record<string, number>) {
  for (const [type, count] of Object.entries(counts)) {
    if (typeof count !== "number" || !Number.isFinite(count) || count < 0)
      continue;
    const key = target.has(type) || target.size < 1024 ? type : "[other]";
    target.set(key, (target.get(key) ?? 0) + count);
  }
}

export function summarizeApproximateUsage(
  sessions: readonly { usage: Pick<Usage, "quality" | "note"> }[],
) {
  const counts = new Map<string, number>();
  let approximateSessions = 0;
  for (const { usage } of sessions) {
    if (usage.quality !== "approx") continue;
    approximateSessions++;
    const reasons = new Set(
      usage.note
        ?.split("。")
        .map((reason) => reason.trim())
        .filter(Boolean),
    );
    if (!reasons.size) reasons.add("未记录原因");
    for (const reason of reasons)
      counts.set(reason, (counts.get(reason) ?? 0) + 1);
  }
  const percent = (count: number, total: number) =>
    total ? Math.round((count / total) * 10000) / 100 : 0;
  return {
    totalSessions: sessions.length,
    approximateSessions,
    percentOfSessions: percent(approximateSessions, sessions.length),
    reasons: [...counts]
      .sort(
        ([a, left], [b, right]) => right - left || (a < b ? -1 : a > b ? 1 : 0),
      )
      .map(([reason, count]) => ({
        reason,
        count,
        percentOfApproximateSessions: percent(count, approximateSessions),
      })),
  };
}

export async function scanCodex(options: ScanOptions = {}) {
  options.signal?.throwIfAborted();
  const home = options.home ?? codexHome();
  const reader = new CodexReader(options);
  const discovered = await reader.discover(home);
  const memory = options.memory;
  memory?.retain(discovered);
  const read = (file: SessionFileRef) =>
    memory?.sessions.read(file, "", () => reader.scan(file)) ??
    reader.scan(file);
  const salt = JSON.stringify([
    options.maxLineBytes ?? null,
    zstdCapability(options.decoder),
  ]);
  let cache: SessionCache | undefined;
  let cacheWarning: string | undefined;
  if (options.cache !== false) {
    try {
      cache = await SessionCache.open(home, salt, options.cacheHome);
    } catch (error) {
      cacheWarning =
        error instanceof Error && error.message === "CACHE_INSIDE_AGENT_HOME"
          ? "缓存目录位于代理数据目录，已禁用缓存"
          : "无法打开缓存目录";
    }
  }
  const cachedSession = async (file: SessionFileRef) =>
    (await options.sessionCache?.read(file)) ?? (await cache?.read(file));
  const files = options.repoRoot
    ? await selectSessionFiles(
        discovered,
        options.repoRoot,
        (file) =>
          memory?.headers.read(file, "", () => reader.metadata(file)) ??
          reader.metadata(file),
        async (file) =>
          (await cachedSession(file)) ?? (await read(file)).session,
        options.signal,
      )
    : discovered;
  const sessions: Session[] = [];
  const failures: { path: string; reason: string }[] = [];
  const unknown = new Map<string, number>();
  const records = new Map<string, number>();
  let parsedFiles = 0;
  let oversizedLines = 0;
  let badLines = 0;
  let partialLines = 0;
  let unavailableZstdFiles = 0;
  for (const file of files) {
    options.signal?.throwIfAborted();
    let session = await cachedSession(file);
    let report = session?.parse;
    if (!session) {
      const outcome = await read(file);
      session = outcome.session;
      report = outcome.parse;
      if (session && report.ok) {
        if (options.cache !== "read-only") await cache?.write(file, session);
        await options.sessionCache?.write(file, session);
      }
      if (outcome.error) {
        failures.push({ path: safePath(file.path), reason: outcome.error });
        if (outcome.error === "ZSTD_UNAVAILABLE") unavailableZstdFiles++;
      }
    }
    if (session) sessions.push(session);
    if (!report) continue;
    if (report.ok) parsedFiles++;
    oversizedLines += report.truncatedLines;
    badLines += report.badLines;
    partialLines += report.partialLines;
    merge(unknown, report.unknownTypes);
    merge(records, report.recordTypes);
  }

  options.signal?.throwIfAborted();
  const titles = await reader.titles(home);
  const canonical = canonicalSessions(sessions);
  const byId = new Map(canonical.map((session) => [session.id, session]));
  const refs = new Map(files.map((file) => [file.path, file]));
  for (const child of canonical) {
    options.signal?.throwIfAborted();
    if (child.parent?.kind !== "fork" || !child.parse.ok) continue;
    const parent = byId.get(child.parent.sessionId);
    if (!parent?.parse.ok) continue;
    const childRef = refs.get(child.files[0].path);
    const parentRef = refs.get(parent.files[0].path);
    if (!childRef || !parentRef || childRef.path === parentRef.path) continue;
    const [childKeys, parentKeys] = await Promise.all([
      memory?.signatures.read(childRef, "", () =>
        readForkSignatures(childRef, options),
      ) ?? readForkSignatures(childRef, options),
      memory?.signatures.read(parentRef, "", () =>
        readForkSignatures(parentRef, options),
      ) ?? readForkSignatures(parentRef, options),
    ]);
    if (!childKeys || !parentKeys) continue;
    const prefix = forkPrefix(childKeys, parentKeys);
    if (prefix === undefined) continue;
    const adjusted = (
      await (memory?.forks.read(childRef, JSON.stringify([...prefix]), () =>
        reader.scan(childRef, prefix),
      ) ?? reader.scan(childRef, prefix))
    ).session;
    if (
      adjusted?.parse.ok &&
      adjusted.id === child.id &&
      adjusted.forkAggregate &&
      (await sameFile(childRef)) &&
      (await sameFile(parentRef))
    ) {
      child.usage = adjusted.usage;
      child.forkAggregate = adjusted.forkAggregate;
    }
  }
  for (const session of canonical) {
    const title = titles.get(session.id);
    if (title) {
      session.title = title;
      session.titleProvenance = "verified";
    }
  }
  const byVersion = new Map<string, number>();
  for (const session of canonical) {
    const version = session.agentVersion || "unknown";
    byVersion.set(version, (byVersion.get(version) ?? 0) + 1);
  }
  return {
    sessions: canonical,
    usage: totalUsage(canonical),
    doctor: {
      agent: reader.agent,
      home: safePath(home),
      zstd: {
        capability: zstdCapability(options.decoder),
        unavailableFiles: unavailableZstdFiles,
      },
      discoveredFiles: files.length,
      compressedFiles: files.filter((file) => file.compressed).length,
      parsedFiles,
      parseCoverage: files.length ? parsedFiles / files.length : null,
      canonicalFiles: canonical.length,
      approximateUsage: summarizeApproximateUsage(canonical),
      alternates: canonical.reduce(
        (count, session) => count + session.alternates.length,
        0,
      ),
      oversizedLines,
      badLines,
      partialLines,
      unknownTypes: top(unknown),
      recordTypes: top(records, 20),
      versions: [...byVersion.entries()]
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([version, count]) => ({ version, count })),
      failures,
      cache: {
        enabled: Boolean(cache),
        hits: cache?.hits ?? 0,
        misses: cache?.misses ?? 0,
        writeFailures: cache?.writeFailures ?? 0,
        ...(cacheWarning ? { warning: cacheWarning } : {}),
      },
    },
  };
}
