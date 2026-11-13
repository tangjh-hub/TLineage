import { expect, test, vi } from "vitest";
import { readHandoffGit } from "./handoff-git.js";

test("uses live Git facts and preserves the first 30 porcelain lines", async () => {
  const run = vi.fn(async (_cwd: string, args: readonly string[]) => {
    if (args.includes("--is-inside-work-tree")) return "true\n";
    if (args.includes("--abbrev-ref")) return "synthetic-branch\n";
    if (args.includes("--verify")) return "a".repeat(40) + "\n";
    if (args.includes("--porcelain"))
      return Array.from({ length: 35 }, (_, i) => " M file" + i).join("\n");
    return " file1 | 1 +\n";
  });
  const facts = await readHandoffGit("/synthetic", run);
  expect(facts).toMatchObject({
    branch: "synthetic-branch",
    head: "a".repeat(40),
    statusTruncated: true,
    diffStat: [" file1 | 1 +"],
  });
  expect(facts.status).toHaveLength(30);
  expect(facts.status?.at(-1)).toBe(" M file29");
  expect(run).toHaveBeenCalledWith("/synthetic", [
    "diff",
    "--no-ext-diff",
    "--no-textconv",
    "--stat",
    "--",
  ]);
});

test("skips an absent repository and reports a Git failure", async () => {
  const run = vi.fn(async () => {
    throw new Error("private error");
  });
  expect(await readHandoffGit(null, run)).toMatchObject({
    unavailable: expect.any(Array),
  });
  expect(run).not.toHaveBeenCalled();
  expect(await readHandoffGit("/synthetic", run)).toEqual({
    unavailable: ["Git working tree could not be verified."],
  });
});

test("retains an unborn branch when HEAD and diff are unavailable", async () => {
  const facts = await readHandoffGit("/synthetic", async (_, args) => {
    if (args.includes("--is-inside-work-tree")) return "true";
    if (args.includes("symbolic-ref")) return "unborn";
    if (args.includes("--porcelain")) return "";
    throw new Error("private error");
  });
  expect(facts).toEqual({
    branch: "unborn",
    status: [],
    statusTruncated: false,
    unavailable: ["HEAD unavailable.", "Git diff stat unavailable."],
  });
});

test("can read only Git refs without invoking working-tree commands", async () => {
  const run = vi.fn(async (_cwd: string, args: readonly string[]) => {
    if (args.includes("--is-inside-work-tree")) return "true";
    if (args.includes("--abbrev-ref")) return "fixture-branch";
    if (args.includes("--verify")) return "b".repeat(40);
    throw new Error("Unexpected Git command");
  });
  const result = await readHandoffGit("/synthetic", run, {
    includeWorkingTree: false,
  });
  expect(result).toMatchObject({
    branch: "fixture-branch",
    head: "b".repeat(40),
  });
  expect(result.status).toBeUndefined();
  expect(result.diffStat).toBeUndefined();
  expect(run.mock.calls.map(([, args]) => args[0])).toEqual([
    "rev-parse",
    "rev-parse",
    "rev-parse",
  ]);
});
