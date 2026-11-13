import {
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { buildGraphs } from "./graph.js";
import { scanCodex } from "./scan.js";

test("scoped scan preserves canonical selection, relations and usage", async () => {
  const home = await mkdtemp(join(tmpdir(), "tlineage-scope-equivalence-"));
  try {
    const repo = join(home, "repo");
    const other = join(home, "other");
    const nested = join(repo, "nested");
    const worktree = join(home, "worktree");
    const gitdir = join(repo, ".git", "worktrees", "linked");
    const link = join(home, "link");
    for (const path of [
      gitdir,
      join(other, ".git"),
      join(nested, ".git"),
      worktree,
      join(home, "sessions"),
    ])
      await mkdir(path, { recursive: true });
    await symlink(repo, link, "junction");
    await writeFile(join(worktree, ".git"), "gitdir: " + gitdir + "\n");
    await writeFile(join(gitdir, "commondir"), "../..\n");
    const at = "2000-01-01T00:00:00Z";
    const row = (type: string, payload: object, timestamp = at) =>
      JSON.stringify({ type, timestamp, payload });
    const save = async (
      file: string,
      id: string,
      cwd: string,
      parents = {},
      end = at,
      prefix = "",
    ) =>
      writeFile(
        join(home, "sessions", file + ".jsonl"),
        prefix +
          [
            row("session_meta", { id, cwd, ...parents }),
            row(
              "event_msg",
              {
                type: "token_count",
                info: {
                  total_token_usage: { total_tokens: 3 },
                  last_token_usage: { total_tokens: 3 },
                },
              },
              end,
            ),
          ].join("\n") +
          "\n",
      );
    await save("local", "local", link);
    await save("sub", "sub", worktree, { parent_thread_id: "local" });
    await save("fork", "fork", repo, { forked_from_id: "foreign" });
    await save("foreign", "foreign", other);
    await save("dup-local", "dup", repo);
    await save("dup-foreign", "dup", other, {}, "2000-01-02T00:00:00Z");
    await save("nested", "nested", nested);
    await save("uncertain", "uncertain", repo, {}, at, "{malformed}\n");
    const compressed = Buffer.from(
      row("session_meta", { id: "compressed", cwd: repo }) + "\n",
    );
    expect(compressed.length).toBeLessThan(256);
    const block = Buffer.alloc(3);
    block.writeUIntLE((compressed.length << 3) | 1, 0, 3);
    await writeFile(
      join(home, "sessions", "compressed.jsonl.zst"),
      Buffer.concat([
        Buffer.from([0x28, 0xb5, 0x2f, 0xfd, 0x20, compressed.length]),
        block,
        compressed,
      ]),
    );
    const scope = { cwd: repo, now: Date.parse(at) };
    const full = await scanCodex({ home, cache: false });
    const scoped = await scanCodex({
      home,
      cache: false,
      repoRoot: await realpath(repo),
    });
    expect(scoped.doctor.discoveredFiles).toBeLessThan(
      full.doctor.discoveredFiles,
    );
    const graphs = await buildGraphs(scoped.sessions, scope);
    expect(graphs).toEqual(await buildGraphs(full.sessions, scope));
    const ids = graphs.flatMap(({ lanes }) =>
      lanes.flatMap(({ sessions }) => sessions.map(({ id }) => id)),
    );
    expect(ids).toContain("compressed");
    expect(ids).not.toContain("dup");
    expect(
      graphs
        .flatMap(({ lanes }) => lanes)
        .some(({ relationships }) => relationships.length),
    ).toBe(true);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
