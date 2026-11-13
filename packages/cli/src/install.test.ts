import {
  access,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, vi } from "vitest";
import { executable, runAgent } from "./install-agent.js";
import { runInstall } from "./install.js";

const source = new URL(
  "../../../integrations/skills/tlineage/SKILL.md",
  import.meta.url,
);
const binary = await executable("codex", process.env);
const exists = (path: string) =>
  access(path).then(
    () => true,
    () => false,
  );
const quiet = () => {};

test("dry-run writes nothing and never invokes an agent, including missing experimental Claude", async () => {
  const home = await mkdtemp(join(tmpdir(), "tlineage-install-dry-"));
  try {
    const run = vi.fn();
    const warmCache = vi.fn();
    const output = vi.fn();
    const env = { PATH: "", CODEX_HOME: join(home, "custom"), HOME: home };
    for (const agent of ["codex", "claude"] as const)
      expect(
        await runInstall({
          action: "install",
          agent,
          dryRun: true,
          prewarm: true,
          warmCache,
          allProjects: true,
          env,
          home,
          run,
          output,
          entry: "/fixture/cli.js",
        }),
      ).toBe(0);
    expect(run).not.toHaveBeenCalled();
    expect(warmCache).not.toHaveBeenCalled();
    expect(await readdir(home)).toEqual([]);
    expect(output.mock.calls.flat().join("\n")).toContain(
      "[experimental，未经实测]",
    );
    const plan = output.mock.calls.flat().join("\n");
    expect(plan).toContain("--all-projects");
    expect(plan).toContain(
      "启动命令使用本机绝对路径（node 与脚本），移动或删除仓库、升级 Node 后 MCP 会失效。",
    );
    expect(plan).toContain("首次需要完整扫描");
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test.skipIf(!binary)(
  "installs, repeats, changes explicit scope and uninstalls with real Codex in temporary HOME",
  async () => {
    const home = await mkdtemp(join(tmpdir(), "tlineage-install-real-"));
    try {
      const agentHome = join(home, "codex-custom");
      const backup = join(home, "tlineage");
      const config = join(agentHome, "config.toml");
      const env = {
        PATH: process.env.PATH,
        HOME: home,
        CODEX_HOME: agentHome,
        TLINEAGE_HOME: backup,
      };
      await mkdir(agentHome);
      await runAgent(
        binary!,
        ["mcp", "add", "unrelated", "--", process.execPath, "--version"],
        env,
        home,
      );
      const prior = await readFile(config);
      const options = {
        agent: "codex" as const,
        env,
        home,
        cwd: home,
        entry: join(home, "fixture cli.js"),
        skillSource: source,
        output: quiet,
      };
      expect(
        await runInstall({ ...options, action: "install", dryRun: true }),
      ).toBe(0);
      expect(await readFile(config)).toEqual(prior);
      expect(await exists(backup)).toBe(false);
      expect(
        await runInstall({
          ...options,
          action: "install",
          approve: async () => false,
        }),
      ).toBe(0);
      expect(await exists(backup)).toBe(false);
      expect(
        await runInstall({ ...options, action: "install", yes: true }),
      ).toBe(0);
      const folder = join(agentHome, "skills", "tlineage");
      expect(await readFile(join(folder, "SKILL.md"), "utf8")).toContain(
        "name: tlineage",
      );
      expect(
        JSON.parse(await readFile(join(folder, ".tlineage-managed"), "utf8")),
      ).toMatchObject({
        version: 1,
        tlineageVersion: "0.0.0",
        agent: "codex",
        launcher: { args: [options.entry, "mcp"] },
      });
      const warmCache = vi.fn(async () => {});
      await runInstall({
        ...options,
        action: "install",
        yes: true,
        prewarm: true,
        warmCache,
        approvePrewarm: async () => false,
      });
      expect(warmCache).not.toHaveBeenCalled();
      await runInstall({
        ...options,
        action: "install",
        yes: true,
        prewarm: true,
        warmCache,
        approvePrewarm: async () => true,
      });
      expect(warmCache).toHaveBeenCalledTimes(1);
      const backupRoot = join(backup, "tlineage-install-backups");
      const first = await readdir(backupRoot);
      expect(first).toHaveLength(1);
      expect(await readFile(join(backupRoot, first[0], "config.toml"))).toEqual(
        prior,
      );
      expect(
        await runInstall({ ...options, action: "install", yes: true }),
      ).toBe(0);
      expect(await readdir(backupRoot)).toEqual(first);
      expect(
        await runInstall({
          ...options,
          action: "install",
          yes: true,
          allProjects: true,
        }),
      ).toBe(0);
      const get = JSON.parse(
        await runAgent(
          binary!,
          ["mcp", "get", "tlineage", "--json"],
          env,
          home,
        ),
      );
      expect(get.transport.args).toEqual([
        options.entry,
        "mcp",
        "--all-projects",
      ]);
      const savedSkill = await readFile(join(folder, "SKILL.md"));
      await writeFile(join(folder, "SKILL.md"), "user edit");
      await expect(
        runInstall({
          ...options,
          action: "uninstall",
          approve: async () => true,
        }),
      ).rejects.toThrow("文件已被修改");
      await writeFile(join(folder, "SKILL.md"), savedSkill);
      expect(
        await runInstall({
          ...options,
          action: "uninstall",
          approve: async () => true,
        }),
      ).toBe(0);
      expect(await exists(folder)).toBe(false);
      const list = JSON.parse(
        await runAgent(binary!, ["mcp", "list", "--json"], env, home),
      );
      expect(list.map(({ name }: { name: string }) => name)).toEqual([
        "unrelated",
      ]);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  },
  20000,
);

test.skipIf(!binary)(
  "protects an unmanaged MCP registration with the same name",
  async () => {
    const home = await mkdtemp(join(tmpdir(), "tlineage-install-collision-"));
    try {
      const env = {
        PATH: process.env.PATH,
        HOME: home,
        CODEX_HOME: join(home, "codex"),
        TLINEAGE_HOME: join(home, "tlineage"),
      };
      await mkdir(env.CODEX_HOME);
      await runAgent(
        binary!,
        ["mcp", "add", "tlineage", "--", process.execPath, "--version"],
        env,
        home,
      );
      const config = join(env.CODEX_HOME, "config.toml");
      const prior = await readFile(config);
      await expect(
        runInstall({
          agent: "codex",
          action: "install",
          yes: true,
          env,
          home,
          cwd: home,
          entry: "/fixture/cli.js",
          skillSource: source,
          output: quiet,
        }),
      ).rejects.toThrow("不符合管理标记");
      expect(await readFile(config)).toEqual(prior);
      expect(await exists(join(env.CODEX_HOME, "skills"))).toBe(false);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  },
);

test("removes the registration and managed files when the vendor add partially fails", async () => {
  const home = await mkdtemp(join(tmpdir(), "tlineage-install-rollback-"));
  try {
    const bin = join(home, "bin");
    const agent = join(home, "agent");
    await mkdir(bin);
    await mkdir(agent);
    const name = process.platform === "win32" ? "codex.exe" : "codex";
    await writeFile(join(bin, name), "synthetic", { mode: 0o700 });
    let args: string[] | undefined;
    const run = vi.fn(async (_binary: string, command: string[]) => {
      if (command[1] === "add") {
        args = command.slice(4);
        throw new Error("simulated partial failure");
      }
      if (command[1] === "remove") args = undefined;
      if (command[1] === "list")
        return JSON.stringify(args ? [{ name: "tlineage" }] : []);
      if (command[1] === "get")
        return JSON.stringify({
          name: "tlineage",
          enabled: true,
          transport: {
            type: "stdio",
            command: args?.[0],
            args: args?.slice(1),
          },
        });
      return "";
    });
    await expect(
      runInstall({
        agent: "codex",
        action: "install",
        yes: true,
        home,
        cwd: home,
        env: { HOME: home, PATH: bin, CODEX_HOME: agent },
        entry: join(home, "fixture.js"),
        skillSource: source,
        run,
        output: quiet,
      }),
    ).rejects.toThrow("已尝试恢复");
    expect(args).toBeUndefined();
    expect(await exists(join(agent, "skills", "tlineage"))).toBe(false);
    expect(run.mock.calls.some(([, command]) => command[1] === "remove")).toBe(
      true,
    );
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test.skipIf(!binary)(
  "supports a fresh explicitly configured Codex home",
  async () => {
    const home = await mkdtemp(join(tmpdir(), "tlineage-install-fresh-"));
    try {
      const env = {
        PATH: process.env.PATH,
        HOME: home,
        CODEX_HOME: join(home, "empty-codex"),
      };
      const options = {
        agent: "codex" as const,
        home,
        env,
        cwd: home,
        entry: "/fixture/cli.js",
        skillSource: source,
        output: quiet,
      };
      expect(
        await runInstall({ ...options, action: "install", dryRun: true }),
      ).toBe(0);
      expect(await exists(env.CODEX_HOME)).toBe(false);
      expect(
        await runInstall({ ...options, action: "install", yes: true }),
      ).toBe(0);
      expect(
        await exists(
          join(env.CODEX_HOME, "skills", "tlineage", ".tlineage-managed"),
        ),
      ).toBe(true);
      expect(
        await runInstall({
          ...options,
          action: "uninstall",
          approve: async () => true,
        }),
      ).toBe(0);
      expect(await exists(join(env.CODEX_HOME, "skills", "tlineage"))).toBe(
        false,
      );
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  },
);
