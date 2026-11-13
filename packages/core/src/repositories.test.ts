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
import { locateRepository, touchedPath } from "./repositories.js";

test("groups a checkout and multiple linked worktrees, and respects the nearest Git marker", async () => {
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), "tlineage-repos-")),
  );
  try {
    const main = join(directory, "main");
    await mkdir(join(main, ".git"), { recursive: true });
    for (const name of ["linked-one", "linked-two"]) {
      const worktree = join(directory, name);
      const metadata = join(main, ".git", "worktrees", name);
      await mkdir(join(worktree, "src"), { recursive: true });
      await mkdir(metadata, { recursive: true });
      await writeFile(join(worktree, ".git"), `gitdir: ${metadata}\n`);
      await writeFile(join(metadata, "commondir"), "../..\n");
      expect(await locateRepository(join(worktree, "src"))).toEqual({
        repoRoot: main,
        worktreePath: worktree,
        resolvedCwd: join(worktree, "src"),
      });
      expect(
        touchedPath(
          { cwd: join(worktree, "src"), worktreePath: worktree },
          "one.ts",
        )?.relative,
      ).toBe("src/one.ts");
    }
    expect(await locateRepository(main)).toEqual({
      repoRoot: main,
      worktreePath: main,
      resolvedCwd: main,
    });
    const alias = join(directory, "alias");
    await symlink(main, alias, "junction");
    const viaAlias = await locateRepository(alias);
    expect(touchedPath({ cwd: alias, ...viaAlias }, "one.ts")).toEqual({
      absolute: join(main, "one.ts"),
      relative: "one.ts",
    });
    expect(
      touchedPath({ cwd: alias, ...viaAlias }, join(alias, "one.ts"))?.absolute,
    ).toBe(join(main, "one.ts"));
    const nested = join(main, "nested");
    await mkdir(join(nested, ".git"), { recursive: true });
    expect(await locateRepository(nested)).toEqual({
      repoRoot: nested,
      worktreePath: nested,
      resolvedCwd: nested,
    });
    expect(await locateRepository(join(directory, "gone"))).toBeUndefined();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
