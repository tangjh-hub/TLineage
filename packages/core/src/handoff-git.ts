import { execFile } from "node:child_process";
import { promisify } from "node:util";

export interface HandoffGit {
  branch?: string;
  head?: string;
  status?: string[];
  statusTruncated?: boolean;
  diffStat?: string[];
  unavailable?: string[];
}

export type GitCommand = (
  repoRoot: string,
  args: readonly string[],
) => Promise<string>;

export const runGit: GitCommand = async (cwd, args) => {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
  );
  const { stdout } = await promisify(execFile)(
    "git",
    [
      "--no-optional-locks",
      "--no-pager",
      "-c",
      "core.fsmonitor=false",
      ...args,
    ],
    {
      cwd,
      env: {
        ...env,
        LC_ALL: "C",
        GIT_TERMINAL_PROMPT: "0",
        GIT_NO_LAZY_FETCH: "1",
      },
      shell: false,
      timeout: 3000,
      maxBuffer: 1024 * 1024,
    },
  );
  return stdout;
};

export type ReadHandoffGit = (repoRoot: string | null) => Promise<HandoffGit>;
const lines = (output: string) =>
  output.trimEnd().split(/\r?\n/).filter(Boolean);

export async function readHandoffGit(
  repoRoot: string | null,
  run: GitCommand = runGit,
  { includeWorkingTree = true } = {},
): Promise<HandoffGit> {
  if (!repoRoot)
    return { unavailable: ["No Git repository found for this scope."] };
  const probe = await run(repoRoot, [
    "rev-parse",
    "--is-inside-work-tree",
  ]).catch(() => "");
  if (probe.trim() !== "true")
    return { unavailable: ["Git working tree could not be verified."] };

  const [branch, head, status, diff] = await Promise.allSettled([
    run(repoRoot, ["rev-parse", "--abbrev-ref", "HEAD"]).catch(() =>
      run(repoRoot, ["symbolic-ref", "--quiet", "--short", "HEAD"]),
    ),
    run(repoRoot, ["rev-parse", "--verify", "HEAD"]),
    includeWorkingTree
      ? run(repoRoot, ["status", "--porcelain"])
      : Promise.resolve(""),
    includeWorkingTree
      ? run(repoRoot, [
          "diff",
          "--no-ext-diff",
          "--no-textconv",
          "--stat",
          "--",
        ])
      : Promise.resolve(""),
  ]);
  const unavailable = [];
  const result: HandoffGit = {};
  if (branch.status === "fulfilled" && branch.value.trim())
    result.branch =
      branch.value.trim() === "HEAD" ? "(detached HEAD)" : branch.value.trim();
  else unavailable.push("Branch unavailable.");
  if (
    head.status === "fulfilled" &&
    /^[a-f0-9]{40,64}$/i.test(head.value.trim())
  )
    result.head = head.value.trim();
  else unavailable.push("HEAD unavailable.");
  if (includeWorkingTree) {
    if (status.status === "fulfilled") {
      const entries = lines(status.value);
      result.status = entries.slice(0, 30);
      result.statusTruncated = entries.length > 30;
    } else unavailable.push("Git status unavailable.");
    if (diff.status === "fulfilled") result.diffStat = lines(diff.value);
    else unavailable.push("Git diff stat unavailable.");
  } else
    unavailable.push(
      "Use the TLineage CLI to inspect working-tree status and diff.",
    );
  if (unavailable.length) result.unavailable = unavailable;
  return result;
}
