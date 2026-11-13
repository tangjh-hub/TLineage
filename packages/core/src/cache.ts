import { NAMING } from "./naming.js";
import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  open,
  constants,
  realpath,
  rename,
  stat,
  unlink,
} from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { REDACTION_RULE_VERSION, redactTree } from "./redact.js";
import { object, type Session, type SessionFileRef } from "./types.js";

const version = 6;
const maxCacheEntry = 64 * 1024 * 1024;

async function realLocation(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch (error) {
    if (object(error).code !== "ENOENT") throw error;
    const parent = dirname(path);
    if (parent === path) throw error;
    return join(await realLocation(parent), relative(parent, path));
  }
}

function contains(parent: string, child: string) {
  const path = relative(parent, child);
  return (
    !path ||
    (!isAbsolute(path) && path !== ".." && !path.startsWith(".." + sep))
  );
}

function isCachedSession(value: unknown): value is Session {
  const session = object(value);
  const parse = object(session.parse);
  const usage = object(session.usage);
  return (
    session.agent === "codex" &&
    typeof session.id === "string" &&
    typeof session.cwd === "string" &&
    typeof session.title === "string" &&
    Array.isArray(session.files) &&
    typeof object(session.files[0]).path === "string" &&
    Array.isArray(session.parents) &&
    Array.isArray(session.alternates) &&
    Array.isArray(session.userMessages) &&
    Array.isArray(session.commands) &&
    typeof session.pendingLastToolCall === "boolean" &&
    Array.isArray(session.filesTouched) &&
    parse.ok === true &&
    typeof parse.lineCount === "number" &&
    typeof parse.lastRecordAt === "string" &&
    typeof parse.badLines === "number" &&
    typeof parse.truncatedLines === "number" &&
    typeof parse.partialLines === "number" &&
    !!parse.unknownTypes &&
    !!parse.recordTypes &&
    usage.scope === "inFile" &&
    (usage.quality === "exact" || usage.quality === "approx") &&
    ["input", "output", "cacheRead", "cacheWrite", "reasoning", "total"].every(
      (key) => typeof usage[key] === "number" && Number.isFinite(usage[key]),
    )
  );
}

export class SessionCache {
  hits = 0;
  misses = 0;
  writeFailures = 0;

  constructor(
    private readonly directory: string,
    private readonly salt: string,
    private readonly ruleVersion = REDACTION_RULE_VERSION,
    private readonly prefix = "",
  ) {}

  static async open(
    codex: string,
    salt: string,
    home = process.env[NAMING.homeVariable] ||
      join(homedir(), NAMING.dataDirectory),
    ruleVersion = REDACTION_RULE_VERSION,
  ) {
    const requested = resolve(home, "cache");
    const location = await realLocation(requested);
    const protectedRoots = [
      codex,
      join(homedir(), ".codex"),
      join(homedir(), ".claude"),
      process.env.CODEX_HOME,
      process.env.CLAUDE_CONFIG_DIR,
    ].filter((path): path is string => Boolean(path));
    for (const root of protectedRoots) {
      const absolute = resolve(root);
      if (
        contains(absolute, requested) ||
        contains(await realLocation(absolute), location)
      ) {
        throw new Error("CACHE_INSIDE_AGENT_HOME");
      }
    }
    return new SessionCache(location, salt, ruleVersion);
  }

  filename(ref: SessionFileRef) {
    const key = JSON.stringify([
      version,
      this.salt,
      this.ruleVersion,
      ref.path,
      ref.sizeBytes,
      ref.mtimeMs,
    ]);
    return join(
      this.directory,
      this.prefix + createHash("sha256").update(key).digest("hex") + ".json",
    );
  }

  async read(ref: SessionFileRef): Promise<Session | undefined> {
    const path = this.filename(ref);
    try {
      const handle = await open(
        path,
        constants.O_RDONLY | constants.O_NOFOLLOW,
      );
      try {
        const info = await handle.stat();
        if (info.isFile() && info.nlink === 1 && info.size <= maxCacheEntry) {
          const value = object(JSON.parse(await handle.readFile("utf8")));
          if (
            value.version === version &&
            (value.owner ?? "") === this.prefix &&
            isCachedSession(value.session)
          ) {
            this.hits++;
            return redactTree(value.session);
          }
        }
      } finally {
        await handle.close();
      }
    } catch {
      // A missing, inaccessible or damaged entry can be recreated.
    }
    this.misses++;
  }

  encode(session: Session): string | undefined {
    const data = JSON.stringify({
      owner: this.prefix,
      version,
      session: redactTree(session),
    });
    return Buffer.byteLength(data) <= maxCacheEntry ? data : undefined;
  }

  async write(ref: SessionFileRef, session: Session): Promise<void> {
    const path = this.filename(ref);
    const temporary = path + "." + randomUUID() + ".tmp";
    let created = false;
    try {
      const current = await stat(ref.path);
      if (current.size !== ref.sizeBytes || current.mtimeMs !== ref.mtimeMs)
        return;
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      const data = this.encode(session);
      if (data === undefined) return;
      const handle = await open(temporary, "wx", 0o600);
      created = true;
      try {
        await handle.writeFile(data);
      } finally {
        await handle.close();
      }
      await rename(temporary, path);
      created = false;
    } catch {
      this.writeFailures++;
    } finally {
      if (created) await unlink(temporary).catch(() => {});
    }
  }
}
