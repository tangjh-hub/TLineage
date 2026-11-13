import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { estimateHandoffTokens } from "../../core/src/handoff.js";
import { historyNotice } from "./privacy.js";
import { createTools, toolDefinitions } from "./tools.js";

test("reads four safe tools without creating or modifying files", async () => {
  const root = await mkdtemp(join(tmpdir(), "tlineage-tools-"));
  try {
    const home = join(root, "agent");
    const cwd = join(root, "workspace");
    await mkdir(join(home, "sessions"), { recursive: true });
    await mkdir(join(cwd, ".git"), { recursive: true });
    const session = join(home, "sessions", "fixture.jsonl");
    const secret = "ghp_" + "s".repeat(32);
    const original =
      "Find the synthetic transcript suffix " +
      "fixture ".repeat(100) +
      "whole-transcript";
    const at = "2000-01-01T00:00:00Z";
    const record = (type: string, payload: object) =>
      JSON.stringify({ type, timestamp: at, payload });
    await writeFile(
      session,
      [
        record("session_meta", { id: "fixture-session", cwd }),
        record("response_item", {
          role: "user",
          type: "message",
          content: [{ text: original }],
        }),
        record("response_item", {
          role: "user",
          type: "message",
          content: [{ text: "short-only" }],
        }),
        record("response_item", {
          role: "assistant",
          phase: "final",
          type: "message",
          content: [
            {
              text: `Check ${cwd}/config and the credential ${secret}, with a synthetic suffix.`,
            },
          ],
        }),
        record("event_msg", {
          type: "item_completed",
          item: {
            type: "CommandExecution",
            id: "test-1",
            command: "pnpm test",
            exit_code: 1,
            aggregated_output: original,
          },
        }),
        record("event_msg", {
          type: "item_completed",
          item: {
            type: "FileChange",
            changes: { [join(cwd, "synthetic.ts")]: { type: "add" } },
          },
        }),
      ].join("\n"),
    );
    const snapshot = await readFile(session);
    const call = createTools({
      home,
      cwd,
      now: () => Date.parse(at),
      readGit: async () => ({ branch: "fixture-branch" }),
    });
    expect(toolDefinitions).toHaveLength(4);
    expect(
      toolDefinitions.every(({ annotations }) => annotations?.readOnlyHint),
    ).toBe(true);
    const invocations: [string, Record<string, unknown>, string][] = [
      ["tlineage_status", {}, "fixture-branch"],
      [
        "tlineage_search",
        { query: "whole-transcript", cwd },
        "fixture-session",
      ],
      [
        "tlineage_get_session",
        { sessionId: "fixture-session", section: "messages" },
        "assistant",
      ],
      [
        "tlineage_get_session",
        { sessionId: "fixture-session", section: "files" },
        "synthetic.ts",
      ],
      [
        "tlineage_get_session",
        { sessionId: "fixture-session", section: "commands" },
        "pnpm test",
      ],
      ["tlineage_handoff", { sessionId: "fixture-session" }, "fixture-branch"],
    ];
    for (const [tool, args, expected] of invocations) {
      const result = await call(tool, args);
      const text = result.content[0].text;
      expect(result.isError).toBeUndefined();
      expect(text.split("\n")[0]).toBe(historyNotice);
      expect(text).toContain(expected);
      for (const privateValue of [secret, root, original, "whole-transcript"])
        expect(text).not.toContain(privateValue);
      expect(estimateHandoffTokens(text)).toBeLessThanOrEqual(4000);
    }
    const limited = await call("tlineage_handoff", {
      sessionId: "fixture-session",
      maxTokens: 64,
    });
    expect(estimateHandoffTokens(limited.content[0].text)).toBeLessThanOrEqual(
      64,
    );
    expect(await readFile(session)).toEqual(snapshot);
    expect((await readdir(root, { recursive: true })).sort()).toEqual([
      "agent",
      "agent/sessions",
      "agent/sessions/fixture.jsonl",
      "workspace",
      "workspace/.git",
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("returns explicit sanitized errors for missing records, invalid arguments and parse failure", async () => {
  const empty = await createTools({
    allProjects: true,
    scan: async () => {
      throw new Error("/private/example");
    },
  })("tlineage_status");
  expect(empty.isError).toBe(true);
  expect(empty.content[0].text).toBe(
    historyNotice +
      "\nUnable to read Codex history. Check access to the local records.",
  );
  const invalid = await createTools()("tlineage_search", {
    query: "/private/example",
    limit: 21,
  });
  expect(invalid.content[0].text).toBe(
    historyNotice + "\nInvalid TLineage tool arguments. Check the tool schema.",
  );
  const root = await mkdtemp(join(tmpdir(), "tlineage-bad-record-"));
  try {
    const folder = join(root, "sessions");
    await mkdir(folder);
    const call = createTools({ home: root, allProjects: true });
    expect(
      (
        await call("tlineage_get_session", {
          sessionId: "absent",
          section: "summary",
        })
      ).content[0].text,
    ).toContain("session not found");
    await writeFile(join(folder, "broken.jsonl"), "{malformed}\n");
    const broken = await call("tlineage_status");
    expect(broken.isError).toBe(true);
    expect(broken.content[0].text).toBe(
      historyNotice + "\nCodex session records could not be parsed.",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("keeps short and late constraints and marks long redacted messages", async () => {
  const root = await mkdtemp(join(tmpdir(), "tlineage-message-"));
  try {
    const at = "2000-01-01T00:00:00Z";
    const record = (type: string, payload: object) =>
      JSON.stringify({ type, timestamp: at, payload });
    await mkdir(join(root, "sessions"));
    await mkdir(join(root, ".git"));
    const short = "先检查测试再改代码";
    const base =
      "不要修改现有缓存逻辑，先核对仓库范围和分支，所有跨仓库的历史查询都必须经过用户明确授权";
    const chinese = base.padEnd(47, "哈") + "。";
    const tail = "Do not add new dependencies.";
    const english = "Context ".padEnd(140 - tail.length, "a") + " " + tail;
    expect([short.length, chinese.length, english.length]).toEqual([
      9, 48, 141,
    ]);
    const long = "超".repeat(650);
    const assistant = "答".repeat(320);
    await writeFile(
      join(root, "sessions", "fixture.jsonl"),
      [
        record("session_meta", { id: "message-fixture", cwd: root }),
        ...["Review the synthetic work.", short, chinese, english, long].map(
          (text) =>
            record("response_item", {
              type: "message",
              role: "user",
              content: [{ text }],
            }),
        ),
        record("response_item", {
          type: "message",
          role: "assistant",
          content: [{ text: assistant }],
        }),
      ].join("\n"),
    );
    const call = createTools({
      home: root,
      cwd: root,
      readGit: async () => ({}),
    });
    const response = await call("tlineage_get_session", {
      sessionId: "message-fixture",
      section: "messages",
    });
    const payload = JSON.parse(
      response.content[0].text.split("\n").slice(1).join("\n"),
    );
    const messages: { excerpt: string; role: string }[] = payload.messages;
    expect(messages.map(({ excerpt }) => excerpt)).toEqual(
      expect.arrayContaining([short, chinese, english]),
    );
    const truncated = messages.find(({ excerpt }) =>
      excerpt.startsWith("超"),
    )!.excerpt;
    expect(Array.from(truncated)).toHaveLength(600);
    expect(truncated).toMatch(/ \[Truncated\]$/);
    const final = messages.find(({ role }) => role === "assistant")!.excerpt;
    expect(Array.from(final)).toHaveLength(300);
    expect(final).toMatch(/ \[Truncated\]$/);
    const pack = await call("tlineage_handoff", {
      sessionId: "message-fixture",
    });
    const constraints = pack.content[0].text
      .split("## Constraints stated by the user [inferred]")[1]
      ?.split("\n## ")[0];
    expect(constraints).toContain(chinese);
    expect(constraints).toContain(tail);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
