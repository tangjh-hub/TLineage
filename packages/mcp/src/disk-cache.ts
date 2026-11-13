import {
  lstatSync,
  readFileSync,
  unlinkSync,
  rmdirSync,
  linkSync,
  renameSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import {
  constants,
  open,
  lstat,
  mkdir,
  readdir,
  realpath,
  unlink,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { SessionCache } from "../../core/src/cache.js";
import { sameFile } from "../../core/src/fork.js";
import { NAMING } from "../../core/src/naming.js";
import { locateRepository } from "../../core/src/repositories.js";
import {
  object,
  type Session,
  type SessionFileRef,
} from "../../core/src/types.js";

const owner = "tlineage-mcp-";
const ownershipHeader = Buffer.from('{"owner":"tlineage-mcp-",');
const entryName = /^tlineage-mcp-[a-f0-9]{64}\.json(?:\.[a-f0-9-]{36}\.tmp)?$/;
const capacity = 256 * 1024 * 1024;
const lifetime = 7 * 24 * 60 * 60 * 1000;

function inside(root: string, path: string) {
  const part = relative(root, path);
  return part !== ".." && !part.startsWith(".." + sep) && !isAbsolute(part);
}

async function directory(path: string, create: boolean) {
  if (create) {
    await mkdir(path, { mode: 0o700 }).catch((error: unknown) => {
      if (object(error).code !== "EEXIST") throw error;
    });
  }
  const info = await lstat(path);
  if (info.isSymbolicLink() || (await realpath(path)) !== path)
    throw new CacheProblem(
      path,
      "目录经过符号链接",
      "改用默认位置的真实私有目录，核对后再手动处理链接。",
    );
  if (!info.isDirectory())
    throw new CacheProblem(
      path,
      "预期为目录",
      "将占用该位置的文件移开后重试。",
    );
  if (info.uid !== process.getuid?.())
    throw new CacheProblem(
      path,
      "目录不属于当前用户",
      "核对目录归属，使用当前用户拥有的私有目录。",
    );
  if ((info.mode & 0o777) !== 0o700)
    throw new CacheProblem(
      path,
      "目录权限不是 0700",
      "确认目录归属后将目录权限改为 0700。",
    );
}

class CacheProblem extends Error {
  constructor(
    readonly path: string,
    readonly reason: string,
    readonly suggestion: string,
  ) {
    super(reason);
  }
}

export function createDiskCache(
  agentHome: string,
  salt: string,
  options: {
    home?: string;
    configuredHome?: string;
    maxBytes?: number;
    maxAge?: number;
    now?: () => number;
  } = {},
) {
  const home = options.home ?? homedir();
  const requested = resolve(home, NAMING.dataDirectory);
  const configured = options.configuredHome ?? process.env[NAMING.homeVariable];
  const maxBytes = options.maxBytes ?? capacity;
  const maxAge = options.maxAge ?? lifetime;
  const now = options.now ?? Date.now;

  async function location(create: boolean) {
    if (process.platform === "win32" || !process.getuid)
      throw new CacheProblem(
        requested,
        "平台不支持所需的 POSIX 权限",
        "使用 --no-cache 或在支持 POSIX 权限的平台运行。",
      );
    if (configured && resolve(configured) !== requested)
      throw new CacheProblem(
        resolve(configured),
        "TLINEAGE_HOME 超出允许的 MCP 缓存范围",
        "取消自定义 TLINEAGE_HOME，或使用默认的 ~/.tlineage。",
      );
    const physicalHome = await realpath(home);
    const data = join(physicalHome, NAMING.dataDirectory);
    const target = join(data, "cache", "mcp");
    const protectedPaths = [
      agentHome,
      join(home, ".codex"),
      join(home, ".claude"),
      process.env.CODEX_HOME,
      process.env.CLAUDE_CONFIG_DIR,
    ];
    for (const root of protectedPaths) {
      if (!root) continue;
      const physical = await realpath(root).catch(() => resolve(root));
      if (
        inside(physical, target) ||
        inside(target, physical) ||
        inside(resolve(root), target) ||
        inside(target, resolve(root))
      )
        throw new CacheProblem(
          target,
          "路径与受保护的代理目录重叠",
          "将代理数据目录与 ~/.tlineage 缓存分开。",
        );
    }
    if (await locateRepository(physicalHome))
      throw new CacheProblem(
        target,
        "路径位于 Git 仓库内",
        "使用仓库之外的主目录，或以 --no-cache 运行。",
      );
    for (const folder of [data, join(data, "cache"), target]) {
      await directory(folder, create);
      // A repository marker at any level also prohibits writes.
      await lstat(join(folder, ".git")).then(
        () => {
          throw new CacheProblem(
            target,
            "路径位于 Git 仓库内",
            "使用仓库之外的主目录，或以 --no-cache 运行。",
          );
        },
        (error: unknown) => {
          if (object(error).code !== "ENOENT") throw error;
        },
      );
    }
    return target;
  }

  async function owned(path: string, inode: number) {
    try {
      const handle = await open(
        path,
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      );
      try {
        const info = await handle.stat();
        if (!info.isFile() || info.ino !== inode || info.nlink !== 1)
          return false;
        const data = Buffer.alloc(ownershipHeader.length);
        const { bytesRead } = await handle.read(data, 0, data.length, 0);
        return bytesRead === data.length && data.equals(ownershipHeader);
      } finally {
        await handle.close();
      }
    } catch {
      return false;
    }
  }

  async function entries(target: string) {
    const files = [];
    for (const name of await readdir(target)) {
      if (!entryName.test(name)) continue;
      const path = join(target, name);
      const info = await lstat(path).catch(() => undefined);
      if (
        info?.isFile() &&
        info.nlink === 1 &&
        info.uid === process.getuid?.() &&
        (info.mode & 0o777) === 0o600
      )
        if (await owned(path, info.ino))
          files.push({
            path,
            bytes: info.size,
            at: info.mtimeMs,
            expired: now() - info.mtimeMs >= maxAge,
          });
    }
    return files.sort((a, b) => a.at - b.at || a.path.localeCompare(b.path));
  }

  function lockState(lock: string) {
    try {
      const info = lstatSync(lock);
      if (
        info.uid !== process.getuid?.() ||
        (!info.isFile() && !info.isDirectory())
      )
        return { info, state: "unsafe" as const };
      let record;
      try {
        if (
          !info.isFile() ||
          info.nlink > 2 ||
          info.size > 1024 ||
          (info.mode & 0o777) !== 0o600
        )
          throw new Error();
        record = object(JSON.parse(readFileSync(lock, "utf8")));
      } catch {
        return {
          info,
          state:
            now() - info.mtimeMs >= 60_000
              ? ("expired" as const)
              : ("invalid" as const),
        };
      }
      if (
        typeof record.pid !== "number" ||
        !Number.isSafeInteger(record.pid) ||
        record.pid < 1 ||
        typeof record.createdAt !== "number" ||
        !Number.isFinite(record.createdAt) ||
        typeof record.token !== "string"
      )
        return { info, state: "invalid" as const };
      let dead = false;
      try {
        process.kill(record.pid, 0);
      } catch (error) {
        dead = object(error).code === "ESRCH";
      }
      return {
        info,
        state:
          dead || now() - record.createdAt >= 60_000
            ? ("expired" as const)
            : ("active" as const),
      };
    } catch (error) {
      if (object(error).code === "ENOENT") return;
      throw error;
    }
  }

  function removeLock(
    lock: string,
    info: NonNullable<ReturnType<typeof lstatSync>>,
  ) {
    const current = lstatSync(lock);
    if (current.ino !== info.ino || current.dev !== info.dev)
      throw new Error("Cache lock changed");
    if (current.isDirectory()) rmdirSync(lock);
    else unlinkSync(lock);
  }

  async function locked<T>(
    target: string,
    action: (assertOwner: () => void) => Promise<T>,
    force = false,
  ) {
    const lock = join(target, ".tlineage-write-lock");
    const token = randomUUID();
    const candidate = join(target, ".tlineage-lock-" + token);
    await directory(target, false);
    await writeFile(
      candidate,
      JSON.stringify({ pid: process.pid, createdAt: now(), token }),
      { mode: 0o600, flag: "wx" },
    );
    let held: NonNullable<ReturnType<typeof lstatSync>> | undefined;
    try {
      const prior = lockState(lock);
      if (prior) {
        if (prior.state === "expired" || (force && prior.state === "invalid"))
          removeLock(lock, prior.info);
        else throw new Error("Cache lock is active, invalid or unsafe");
      }
      linkSync(candidate, lock);
      held = lstatSync(candidate);
      unlinkSync(candidate);
      const ownedLock = held;
      return await action(() => {
        const current = lstatSync(lock);
        if (
          current.ino !== ownedLock.ino ||
          current.dev !== ownedLock.dev ||
          now() - ownedLock.mtimeMs >= 60_000
        )
          throw new Error("Cache lock lost");
      });
    } finally {
      if (held) {
        try {
          removeLock(lock, held);
        } catch {
          /* A different writer may hold the lock. */
        }
      }
      await unlink(candidate).catch(() => {});
    }
  }

  function store(target: string) {
    return new SessionCache(target, salt, undefined, owner);
  }

  type Pending = { ref: SessionFileRef; data: string; bytes: number };

  async function commit(pending: Iterable<Pending>) {
    try {
      const target = await location(true);
      const cache = store(target);
      await locked(target, async (assertOwner) => {
        const files = await entries(target);
        const indexed = new Map(files.map((file) => [file.path, file]));
        let occupied = files.reduce((sum, file) => sum + file.bytes, 0);
        function remove(file: (typeof files)[number]) {
          assertOwner();
          unlinkSync(file.path);
          indexed.delete(file.path);
          occupied -= file.bytes;
        }
        for (const file of files) if (file.expired) remove(file);
        let next = 0;
        for (const { ref, data, bytes } of pending) {
          if (!(await sameFile(ref))) continue;
          const final = cache.filename(ref);
          const prior = indexed.get(final);
          if (!prior && (await lstat(final).catch(() => undefined))) continue;
          if (prior) remove(prior);
          while (occupied + bytes > maxBytes && next < files.length) {
            const oldest = files[next++];
            if (indexed.has(oldest.path)) remove(oldest);
          }
          if (occupied + bytes > maxBytes) continue;
          const temp = final + "." + randomUUID() + ".tmp";
          try {
            assertOwner();
            await writeFile(temp, data, { mode: 0o600, flag: "wx" });
            assertOwner();
            renameSync(temp, final);
            occupied += bytes;
          } finally {
            await unlink(temp).catch(() => {});
          }
        }
      });
    } catch {
      // A busy or unavailable cache must not prevent scans.
    }
  }

  function encode(ref: SessionFileRef, session: Session): Pending | undefined {
    const data = store(requested).encode(session);
    if (data === undefined) return;
    const bytes = Buffer.byteLength(data);
    if (bytes <= maxBytes) return { ref, data, bytes };
  }

  return {
    hits: 0,
    misses: 0,
    async read(ref: SessionFileRef) {
      try {
        const target = await location(false);
        const cache = store(target);
        const info = await lstat(cache.filename(ref));
        if (
          !info.isFile() ||
          info.nlink !== 1 ||
          info.uid !== process.getuid?.() ||
          (info.mode & 0o777) !== 0o600 ||
          now() - info.mtimeMs >= maxAge
        )
          throw new Error("Unavailable cache entry");
        const session = await cache.read(ref);
        if (session) {
          this.hits++;
          return session;
        }
      } catch {
        // Missing or unsafe entries fall back to source parsing.
      }
      this.misses++;
    },
    async write(ref: SessionFileRef, session: Session) {
      const entry = encode(ref, session);
      if (entry) await commit([entry]);
    },
    batch() {
      const pending: Pending[] = [];
      let bytes = 0;
      return {
        read: this.read.bind(this),
        async write(ref: SessionFileRef, session: Session) {
          const entry = encode(ref, session);
          if (
            !entry ||
            bytes + entry.bytes > Math.min(maxBytes, 64 * 1024 * 1024)
          )
            return;
          bytes += entry.bytes;
          pending.push(entry);
        },
        async flush() {
          if (pending.length) await commit(pending);
          pending.length = 0;
          bytes = 0;
        },
      };
    },
    async diagnose() {
      try {
        const status = await this.status();
        if (status.lock) {
          const suggestions = {
            active: "等待持锁进程完成后重试。",
            expired: "下一次写入或清理将自动接管。",
            invalid: "确认无写进程后运行 tlineage cache clear --force-unlock。",
            unsafe: "检查锁路径的文件类型及归属，再手动处理。",
          };
          return {
            ...status,
            path: join(requested, "cache", "mcp"),
            reason: "MCP 缓存锁：" + status.lock,
            suggestion: suggestions[status.lock],
          };
        }
        return { ...status, path: join(requested, "cache", "mcp") };
      } catch (error) {
        if (error instanceof CacheProblem)
          return {
            path: error.path,
            reason: error.reason,
            suggestion: error.suggestion,
          };
        return {
          path: join(requested, "cache", "mcp"),
          reason: "无法读取缓存目录或锁",
          suggestion: "检查该路径的存在性、所有者和访问权限。",
        };
      }
    },
    async status() {
      let target: string;
      try {
        target = await location(false);
      } catch (error) {
        if (object(error).code === "ENOENT")
          return { entries: 0, bytes: 0, expired: 0 };
        throw error;
      }
      const files = await entries(target);
      const lock = lockState(join(target, ".tlineage-write-lock"))?.state;
      return {
        entries: files.length,
        bytes: files.reduce((sum, file) => sum + file.bytes, 0),
        expired: files.filter((file) => file.expired).length,
        ...(lock ? { lock } : {}),
      };
    },
    async clear(force = false) {
      let target: string;
      try {
        target = await location(false);
      } catch (error) {
        if (object(error).code === "ENOENT") return 0;
        throw error;
      }
      return locked(
        target,
        async (assertOwner) => {
          const files = await entries(target);
          for (const file of files) {
            assertOwner();
            unlinkSync(file.path);
          }
          return files.length;
        },
        force,
      );
    },
  };
}
