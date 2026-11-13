import { spawn } from "node:child_process";
import { once } from "node:events";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Protocol, type BaseContext } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { fileURLToPath } from "node:url";
import { build } from "tsup";
import { expect, test, vi } from "vitest";
import { estimateHandoffTokens } from "../../core/src/handoff.js";
import { historyNotice } from "./privacy.js";

class LegacyClient extends Protocol<BaseContext> {
  protected buildContext(context: BaseContext) {
    return context;
  }
  protected assertCapabilityForMethod() {}
  protected assertNotificationCapability() {}
  protected assertRequestHandlerCapability() {}

  async initialize() {
    const result = await this.request(
      {
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "old-initialize-client", version: "1.0.0" },
        },
      },
      { timeout: 5000 },
    );
    this._negotiatedProtocolVersion = result.protocolVersion;
    await this.notification({ method: "notifications/initialized" });
    return result;
  }
}

test("serves the four read-only tools over Codex's initialize handshake, then exits on EOF", async () => {
  const root = await mkdtemp(join(tmpdir(), "tlineage-protocol-"));
  const codex = join(root, "agent");
  const checkout = join(root, "workspace");
  const out = join(root, "output");
  try {
    await build({
      config: false,
      entry: {
        cli: fileURLToPath(new URL("../../cli/src/index.ts", import.meta.url)),
      },
      outDir: out,
      format: ["esm"],
      platform: "node",
      target: "node20",
      noExternal: [/^@modelcontextprotocol\//, /^zod(?:\/|$)/],
      outExtension: () => ({ js: ".mjs" }),
      silent: true,
    });
    await mkdir(join(codex, "sessions"), { recursive: true });
    await mkdir(join(checkout, ".git"), { recursive: true });
    const secret = "ghp_" + "a".repeat(30);
    const transcript =
      "Search needle: " + "synthetic fragment ".repeat(45) + "tail-marker";
    const at = "2000-01-01T00:00:00Z";
    const record = (type: string, payload: object) =>
      JSON.stringify({ type, timestamp: at, payload });
    const file = join(codex, "sessions", "fixture.jsonl");
    await writeFile(
      file,
      [
        record("session_meta", { id: "synthetic-mcp", cwd: checkout }),
        record("response_item", {
          type: "message",
          role: "user",
          content: [{ text: transcript }],
        }),
        record("response_item", {
          type: "message",
          role: "assistant",
          content: [
            {
              text: `Use ${secret} in ${checkout}/config for a synthetic example.`,
            },
          ],
        }),
      ].join("\n"),
    );
    const before = await readFile(file);
    const dirs = (await readdir(root, { recursive: true })).sort();
    const child = spawn(
      process.execPath,
      [join(out, "cli.mjs"), "mcp", "--no-cache"],
      {
        cwd: checkout,
        env: {
          ...process.env,
          HOME: root,
          CODEX_HOME: codex,
          TLINEAGE_HOME: join(root, ".tlineage"),
        },
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    const exited = once(child, "close");
    let stdout = "";
    const stderr: string[] = [];
    const sdkErrors: Error[] = [];
    child.stdout.on("data", (value: Buffer) => {
      stdout += value.toString();
    });
    child.stderr.on("data", (value: Buffer) => stderr.push(value.toString()));
    const client = new LegacyClient();
    client.onerror = (error) => sdkErrors.push(error);

    try {
      await client.connect(new StdioServerTransport(child.stdout, child.stdin));
      expect((await client.initialize()).protocolVersion).toBe("2025-06-18");
      const list = await client.request(
        { method: "tools/list" },
        { timeout: 5000 },
      );
      expect(list.tools.map(({ name }) => name)).toEqual([
        "tlineage_status",
        "tlineage_handoff",
        "tlineage_search",
        "tlineage_get_session",
      ]);
      expect(
        list.tools.every(({ annotations }) => annotations?.readOnlyHint),
      ).toBe(true);

      for (const [name, args] of [
        ["tlineage_status", { cwd: checkout }],
        ["tlineage_handoff", { sessionId: "synthetic-mcp", maxTokens: 256 }],
        ["tlineage_search", { query: "needle", cwd: checkout }],
        [
          "tlineage_get_session",
          { sessionId: "synthetic-mcp", section: "messages" },
        ],
      ] as const) {
        const answer = await client.request(
          {
            method: "tools/call",
            params: { name, arguments: args },
          },
          { timeout: 5000 },
        );
        expect(answer.isError).toBeUndefined();
        const content = answer.content[0];
        if (content.type !== "text") throw new Error("Expected text content");
        const text = content.text;
        expect(text.split("\n")[0]).toBe(historyNotice);
        expect(text).not.toContain(secret);
        expect(text).not.toContain(root);
        expect(text).not.toContain(transcript);
        expect(estimateHandoffTokens(text)).toBeLessThanOrEqual(
          name === "tlineage_handoff" ? 256 : 4000,
        );
      }
      const missing = await client.request(
        {
          method: "tools/call",
          params: {
            name: "tlineage_get_session",
            arguments: { sessionId: "missing", section: "summary" },
          },
        },
        { timeout: 5000 },
      );
      expect(missing.isError).toBe(true);
      expect(missing.content[0]).toMatchObject({
        type: "text",
        text:
          historyNotice +
          "\nCodex session not found in the allowed repository.",
      });
      const messages = stdout
        .trimEnd()
        .split("\n")
        .map((line) => JSON.parse(line));
      expect(messages.every((message) => message.jsonrpc === "2.0")).toBe(true);
      expect(messages.length).toBeGreaterThanOrEqual(7);
      expect(sdkErrors).toEqual([]);
      expect(stderr).toEqual([]);
    } finally {
      child.stdin.end();
      const kill = setTimeout(() => child.kill(), 2000);
      try {
        expect(await exited).toEqual([0, null]);
      } finally {
        clearTimeout(kill);
      }
    }
    expect(await readFile(file)).toEqual(before);
    expect((await readdir(root, { recursive: true })).sort()).toEqual(dirs);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 25_000);

test("the first tool call joins prewarm and a failed prewarm can retry", async () => {
  const { createTools } = await import("./tools.js");
  const { scanCodex } = await import("../../core/src/scan.js");
  const root = await mkdtemp(join(tmpdir(), "tlineage-prewarm-"));
  try {
    await mkdir(join(root, ".git"));
    const result = await scanCodex({ home: root, cache: false });
    let finish!: (value: typeof result) => void;
    const pending = new Promise<typeof result>((resolve) => {
      finish = resolve;
    });
    const scan = vi.fn(() => pending);
    const call = createTools({ cwd: root, scan, prewarm: true });
    await vi.waitFor(() => expect(scan).toHaveBeenCalledTimes(1));
    const requests = [
      call("tlineage_status"),
      call("tlineage_search", { query: "fixture" }),
    ];
    await new Promise<void>((resolve) => setImmediate(resolve));
    finish(result);
    expect((await Promise.all(requests)).every(({ isError }) => !isError)).toBe(
      true,
    );
    expect(scan).toHaveBeenCalledTimes(1);
    const retry = vi
      .fn()
      .mockRejectedValueOnce(new Error("fixture"))
      .mockResolvedValue(result);
    const retryCall = createTools({ cwd: root, scan: retry, prewarm: true });
    await vi.waitFor(() => expect(retry).toHaveBeenCalledTimes(1));
    expect((await retryCall("tlineage_status")).isError).toBeUndefined();
    expect(retry).toHaveBeenCalledTimes(2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
