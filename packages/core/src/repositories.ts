import { readFile, realpath, stat } from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from "node:path";
import type { Session } from "./types.js";

export interface RepositoryLocation {
  repoRoot: string;
  worktreePath: string;
  resolvedCwd: string;
}

async function gitDirectory(checkout: string): Promise<string | undefined> {
  const marker = resolve(checkout, ".git");
  const info = await stat(marker);
  if (info.isDirectory()) return realpath(marker);
  if (!info.isFile()) return;
  const pointer = /^gitdir: (.+)$/.exec(
    (await readFile(marker, "utf8")).trim(),
  );
  if (pointer) {
    const directory = await realpath(resolve(checkout, pointer[1]));
    if ((await stat(directory)).isDirectory()) return directory;
  }
}

async function rootOfWorktrees(gitDir: string, checkout: string) {
  try {
    const common = await realpath(
      resolve(
        gitDir,
        (await readFile(resolve(gitDir, "commondir"), "utf8")).trim(),
      ),
    );
    if (basename(common) === ".git") return dirname(common);
  } catch {
    // A main checkout has no commondir file.
  }
  return checkout;
}

export async function locateRepository(
  cwd: string,
): Promise<RepositoryLocation | undefined> {
  if (!isAbsolute(cwd)) return;
  let resolvedCwd: string;
  try {
    resolvedCwd = await realpath(cwd);
    if (!(await stat(resolvedCwd)).isDirectory()) return;
  } catch {
    return;
  }
  let checkout = resolvedCwd;
  for (;;) {
    try {
      const gitDir = await gitDirectory(checkout);
      if (gitDir)
        return {
          repoRoot: await rootOfWorktrees(gitDir, checkout),
          worktreePath: checkout,
          resolvedCwd,
        };
    } catch {
      // An absent or unreadable marker gives no evidence for this ancestor.
    }
    const parent = dirname(checkout);
    if (parent === checkout) return;
    checkout = parent;
  }
}

export function repositoryKey(session: Pick<Session, "cwd" | "repoRoot">) {
  return session.repoRoot ?? session.cwd;
}

function within(base: string, path: string) {
  const child = relative(base, path);
  if (
    child &&
    child !== ".." &&
    !child.startsWith(".." + sep) &&
    !isAbsolute(child)
  )
    return child;
}

export function touchedPath(
  session: Pick<Session, "cwd" | "worktreePath" | "resolvedCwd">,
  path: string,
) {
  if (
    !path ||
    path.includes("[REDACTED:") ||
    session.cwd.includes("[REDACTED:")
  )
    return;
  const base = session.worktreePath ?? session.cwd;
  if (!isAbsolute(base) || !isAbsolute(session.cwd)) return;
  const cwd = session.resolvedCwd ?? session.cwd;
  let absolute = resolve(cwd, path);
  let child = within(base, absolute);
  if (!child && isAbsolute(path) && cwd !== session.cwd) {
    const recordedCheckout = resolve(session.cwd, relative(cwd, base));
    child = within(recordedCheckout, absolute);
    if (child) absolute = resolve(base, child);
  }
  return child ? { absolute, relative: child.split(sep).join("/") } : undefined;
}
