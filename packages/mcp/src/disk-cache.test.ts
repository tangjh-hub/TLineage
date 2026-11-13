import { spawn } from "node:child_process";
import { once } from "node:events";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { CodexReader } from "../../core/src/codex.js";
import { createDiskCache } from "./disk-cache.js";

test.skipIf(process.platform === "win32")(
  "MCP cache enforces boundaries, retention, modes and ownership",
  async () => {
    const home = await realpath(
      await mkdtemp(join(tmpdir(), "tlineage-disk-")),
    );
    try {
      const agent = join(home, ".codex");
      await mkdir(join(agent, "sessions"), { recursive: true });
      const file = join(agent, "sessions", "sample.jsonl");
      await writeFile(
        file,
        JSON.stringify({
          type: "session_meta",
          payload: { id: "synthetic", cwd: "/example/synthetic" },
        }) + "\n",
      );
      const reader = new CodexReader();
      const [ref] = await reader.discover(agent);
      const { session } = await reader.scan(ref);
      if (!session) throw new Error("missing synthetic fixture");
      const root = join(home, ".tlineage");
      const dir = join(root, "cache", "mcp");
      const config = { home, configuredHome: root };
      const cache = createDiskCache(agent, "decoder", config);
      expect(await cache.status()).toEqual({
        entries: 0,
        bytes: 0,
        expired: 0,
      });
      expect(await readdir(home)).toEqual([".codex"]);
      await createDiskCache(agent, "decoder", {
        ...config,
        configuredHome: agent,
      }).write(ref, session);
      expect(await readdir(home)).toEqual([".codex"]);
      const secret = "ghp_" + "a".repeat(40);
      await Promise.all([
        cache.write(ref, { ...session, title: secret }),
        cache.write(ref, { ...session, title: secret }),
      ]);
      expect((await cache.read(ref))?.title).not.toContain(secret);
      const [name] = await readdir(dir);
      expect(await readFile(join(dir, name), "utf8")).not.toContain(secret);
      expect((await lstat(dir)).mode & 0o777).toBe(0o700);
      await chmod(dir, 0o755);
      expect(await cache.diagnose()).toMatchObject({
        path: dir,
        reason: expect.stringContaining("0700"),
        suggestion: expect.stringContaining("0700"),
      });
      await chmod(dir, 0o700);
      await mkdir(join(dir, ".git"));
      expect((await cache.diagnose()).reason).toContain("Git");
      await rm(join(dir, ".git"), { recursive: true });

      expect((await lstat(join(dir, name))).mode & 0o777).toBe(0o600);
      expect(
        await createDiskCache(agent, "different decoder", config).read(ref),
      ).toBeUndefined();
      await createDiskCache(agent, "decoder", { ...config, maxBytes: 1 }).write(
        ref,
        session,
      );
      expect((await cache.status()).entries).toBe(1);
      const expired = createDiskCache(agent, "decoder", {
        ...config,
        now: () => Date.now() + 8 * 86400000,
      });
      expect(await expired.read(ref)).toBeUndefined();
      expect((await expired.status()).expired).toBe(1);
      await writeFile(join(root, "cache", "cli.json"), "unrelated");
      await writeFile(join(dir, "unrelated.json"), "unrelated");
      await symlink(
        file,
        join(dir, "tlineage-mcp-" + "b".repeat(64) + ".json"),
      );
      const lookalike = join(dir, "tlineage-mcp-" + "c".repeat(64) + ".json");
      await writeFile(lookalike, "unrelated", { mode: 0o600 });
      const lock = join(dir, ".tlineage-write-lock");
      const child = spawn(
        process.execPath,
        [
          "-e",
          `
        require("node:fs").writeFileSync(process.argv[1], JSON.stringify({
          pid: process.pid, createdAt: Date.now(), token: "synthetic"
        }), {mode: 0o600});
        process.stdout.write("ready");
        setInterval(() => {}, 1000);
      `,
          lock,
        ],
        { stdio: ["ignore", "pipe", "ignore"] },
      );
      const exited = once(child, "exit");
      try {
        await once(child.stdout, "data");
        expect((await cache.status()).lock).toBe("active");
        await expect(cache.clear(true)).rejects.toThrow();
        child.kill("SIGKILL");
        await exited;
        expect((await cache.status()).lock).toBe("expired");
        const batch = cache.batch();
        await batch.write(ref, session);
        expect((await cache.status()).lock).toBe("expired");
        await batch.flush();
        expect((await cache.status()).lock).toBeUndefined();
      } finally {
        if (child.exitCode === null && child.signalCode === null) child.kill();
        await exited;
      }
      await writeFile(
        lock,
        JSON.stringify({
          pid: process.pid,
          createdAt: Date.now() - 61_000,
          token: "expired",
        }),
        { mode: 0o600 },
      );
      expect((await cache.status()).lock).toBe("expired");
      expect(await cache.clear()).toBe(1);
      await writeFile(lock, "invalid", { mode: 0o600 });
      await expect(cache.clear()).rejects.toThrow();
      expect(await cache.clear(true)).toBe(0);
      expect(await readFile(lookalike, "utf8")).toBe("unrelated");
      expect(await readFile(join(root, "cache", "cli.json"), "utf8")).toBe(
        "unrelated",
      );
      expect(await readFile(join(dir, "unrelated.json"), "utf8")).toBe(
        "unrelated",
      );
      expect(await readdir(dir)).toHaveLength(3);
      await rm(root, { recursive: true });
      await symlink(agent, root, "junction");
      await cache.write(ref, session);
      expect(await readdir(agent)).toEqual(["sessions"]);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  },
);
