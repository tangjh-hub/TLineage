import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { SessionCache } from "./cache.js";
import { CodexReader } from "./codex.js";
import { scanCodex } from "./scan.js";

let home: string;
let sessions: string;
let scratch: string;
const at = "2000-01-01T00:00:00.000Z";
const meta = (id: string, fields: Record<string, unknown> = {}) =>
  row("session_meta", {
    id,
    cwd: "/example/fictional",
    cli_version: "0.166.0-alpha.3.2",
    ...fields,
  });
function row(type: string, payload: object = {}, timestamp = at) {
  return JSON.stringify({ timestamp, type, payload });
}

beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), "tlineage-codex-"));
  home = join(scratch, "codex");
  sessions = join(home, "sessions");
  await mkdir(sessions, { recursive: true });
});
afterEach(async () => {
  await rm(scratch, { recursive: true, force: true });
});

test("keeps the first meta, reads both parent kinds, skips unknown and partial records, and redacts evidence", async () => {
  const fake = "sk-fixtureSecretOnly00000000";
  await writeFile(
    join(sessions, "rollout.jsonl"),
    [
      meta("child", {
        forked_from_id: "fork-parent",
        parent_thread_id: "spawn-parent",
      }),
      meta("copied-parent", { cwd: "/example/wrong" }),
      row("response_item", {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "Test " + fake }],
      }),
      row("response_item", {
        type: "function_call",
        name: "exec_command",
        call_id: "test",
        arguments: JSON.stringify({ cmd: "pnpm test" }),
      }),
      row("response_item", {
        type: "function_call_output",
        call_id: "test",
        output:
          "Chunk ID: simulated\nWall time: 0 seconds\nProcess exited with code 8",
      }),
      row("event_msg", {
        type: "item_completed",
        item: {
          type: "CommandExecution",
          id: "test",
          command: ["/bin/sh", "-c", "pnpm test"],
          exit_code: 2,
          aggregated_output: "API_TOKEN=" + fake,
        },
      }),
      row("response_item", {
        type: "function_call",
        name: "exec_command",
        call_id: "other",
        arguments: JSON.stringify({ cmd: "echo hi > shell-only.txt" }),
      }),
      row("response_item", {
        type: "function_call_output",
        call_id: "other",
        output: "some output\nProcess exited with code 7",
      }),
      row("response_item", {
        type: "custom_tool_call",
        name: "apply_patch",
        input:
          "*** Begin Patch\n*** Add File: a.txt\n+synthetic\n*** End Patch",
      }),
      row("event_msg", {
        type: "item_completed",
        item: {
          type: "FileChange",
          changes: { "old.txt": { type: "update", move_path: "new.txt" } },
        },
      }),
      row("compacted", {
        message: "",
        replacement_history: [
          { type: "message", content: [{ text: "do not reuse" }] },
        ],
      }),
      row("world_state"),
      row("realtime_item"),
      row("inter_agent_communication_metadata"),
    ].join("\n") + '\n{"type":"event_msg",',
  );

  const result = await scanCodex({ home, cache: false });
  const [session] = result.sessions;
  expect(session).toMatchObject({
    id: "child",
    cwd: "/example/fictional",
    agentVersion: "0.166.0-alpha.3.2",
  });
  expect(
    session.parents.map(({ kind, sessionId }) => [kind, sessionId]),
  ).toEqual([
    ["fork", "fork-parent"],
    ["subagent", "spawn-parent"],
  ]);
  expect(session.commands[0]).toMatchObject({ exitCode: 2, kind: "test" });
  expect(session.commands[1].exitCode).toBeUndefined();
  expect(
    session.filesTouched.map(({ path, op, provenance }) => [
      path,
      op,
      provenance,
    ]),
  ).toEqual([
    ["a.txt", "create", "verified"],
    ["old.txt", "delete", "verified"],
    ["new.txt", "create", "verified"],
  ]);
  expect(session.compactionSummaries).toEqual([]);
  expect(session.parse).toMatchObject({
    ok: true,
    partialLines: 1,
    unknownTypes: {
      world_state: 1,
      realtime_item: 1,
      inter_agent_communication_metadata: 1,
    },
  });
  expect(JSON.stringify(result)).not.toContain(fake);
});

test("selects canonical by last record time then line count and keeps alternates out of usage", async () => {
  const earlier = "2000-01-01T00:00:01Z";
  const later = "2000-01-01T00:00:02Z";
  const counter = (amount: number, time: string) =>
    row(
      "event_msg",
      {
        type: "token_count",
        info: {
          last_token_usage: { total_tokens: amount },
          total_token_usage: { total_tokens: amount },
        },
      },
      time,
    );
  await writeFile(
    join(sessions, "earlier.jsonl"),
    [
      meta("same"),
      row("world_state"),
      row("world_state"),
      counter(100, earlier),
    ].join("\n"),
  );
  await writeFile(
    join(sessions, "short.jsonl"),
    [meta("same"), counter(50, later)].join("\n"),
  );
  await writeFile(
    join(sessions, "canonical.jsonl"),
    [
      meta("same", {
        source: {
          subagent: { thread_spawn: { parent_thread_id: "nested-parent" } },
        },
      }),
      row("world_state"),
      counter(10, later),
    ].join("\n"),
  );
  const result = await scanCodex({ home, cache: false });
  expect(result.sessions).toHaveLength(1);
  expect(result.sessions[0].files[0].path).toMatch(/canonical\.jsonl$/);
  expect(result.sessions[0].parent?.sessionId).toBe("nested-parent");
  expect(result.sessions[0].alternates).toHaveLength(2);
  expect(result.usage.total).toBe(10);
  expect(result.doctor).toMatchObject({
    parsedFiles: 3,
    canonicalFiles: 1,
    alternates: 2,
  });
});

test("reports missing decoder and malformed files while classifying oversized prefixes at the right depth", async () => {
  await writeFile(join(sessions, "fake.jsonl.zst"), "fake");
  await writeFile(join(sessions, "bad.jsonl"), "invalid\n");
  await writeFile(
    join(sessions, "oversized.jsonl"),
    [
      meta("good"),
      '{"payload":{"type":"misleading"},"type":"world_state","content":"' +
        "x".repeat(2048) +
        '"}',
      row("token_usage_record", {}),
    ].join("\n"),
  );
  const result = await scanCodex({
    home,
    cache: false,
    decoder: "none",
    maxLineBytes: 256,
  });
  expect(result.doctor).toMatchObject({
    discoveredFiles: 3,
    parsedFiles: 1,
    oversizedLines: 1,
    zstd: { capability: "unavailable", unavailableFiles: 1 },
  });
  expect(result.doctor.failures.map((failure) => failure.reason)).toEqual([
    "SESSION_META_ID_MISSING",
    "ZSTD_UNAVAILABLE",
  ]);
  expect(result.sessions[0].parse.unknownTypes).toEqual({ world_state: 1 });
  expect(result.sessions[0].parse.recordTypes.token_usage_record).toBe(1);
});

test("reads M0 fork, truncated, and compressed examples", async () => {
  const reader = new CodexReader({ decoder: "js" });
  for (const name of [
    "codex-fork.jsonl",
    "codex-partial.jsonl",
    "codex-synthetic-short.jsonl.zst",
  ]) {
    const contents = await readFile(
      new URL(`../../../fixtures/${name}`, import.meta.url),
    );
    await writeFile(join(sessions, name), contents);
  }
  const result = await scanCodex({ home, cache: false, decoder: "js" });
  expect(result.doctor).toMatchObject({
    parsedFiles: 3,
    oversizedLines: 0,
    partialLines: 1,
  });
  const fork = (
    await reader.parse(
      (await reader.discover(home)).find(({ path }) =>
        path.endsWith("codex-fork.jsonl"),
      )!,
    )
  )[0];
  expect(fork.parent?.kind).toBe("fork");
  expect(fork.id).not.toBe(fork.parent?.sessionId);
});

test("reuses sanitized cache, misses after file changes, and blocks aliases into agent data", async () => {
  const file = join(sessions, "current.jsonl");
  const cacheHome = join(scratch, "tlineage");
  const fake = "ghp_" + "a".repeat(36);
  await writeFile(
    file,
    [
      meta("first"),
      row("response_item", { type: "message", role: "user", content: fake }),
    ].join("\n"),
  );
  expect((await scanCodex({ home, cacheHome })).doctor.cache).toMatchObject({
    misses: 1,
    writeFailures: 0,
  });
  expect((await scanCodex({ home, cacheHome })).doctor.cache.hits).toBe(1);
  const cacheFolder = join(cacheHome, "cache");
  const [cached] = await readdir(cacheFolder);
  expect(await readFile(join(cacheFolder, cached), "utf8")).not.toContain(fake);
  await writeFile(file, meta("second") + "\n");
  const refreshed = await scanCodex({ home, cacheHome });
  expect(refreshed.doctor.cache).toMatchObject({ hits: 0, misses: 1 });
  expect(refreshed.sessions[0].id).toBe("second");
  const alias = join(scratch, "alias");
  await symlink(home, alias, "junction");
  expect(
    (await scanCodex({ home, cacheHome: alias })).doctor.cache,
  ).toMatchObject({
    enabled: false,
    warning: expect.stringContaining("代理数据目录"),
  });
  expect(await readdir(home)).toEqual(["sessions"]);
});

test("prefers a later sub-millisecond record timestamp over a longer alternate", async () => {
  await writeFile(
    join(sessions, "longer.jsonl"),
    [
      meta("same"),
      row("world_state"),
      row("event_msg", {}, "2000-01-01T00:00:00.000001Z"),
    ].join("\n"),
  );
  await writeFile(
    join(sessions, "latest.jsonl"),
    [meta("same"), row("event_msg", {}, "2000-01-01T00:00:00.000002Z")].join(
      "\n",
    ),
  );
  expect(
    (await scanCodex({ home, cache: false })).sessions[0].files[0].path,
  ).toMatch(/latest\.jsonl$/);
});

test("associates a legacy polled exit header with the original command", async () => {
  await writeFile(
    join(sessions, "poll.jsonl"),
    [
      meta("poll"),
      row("response_item", {
        type: "function_call",
        name: "exec_command",
        call_id: "start",
        arguments: { cmd: "pnpm build" },
      }),
      row("response_item", {
        type: "function_call_output",
        call_id: "start",
        output: "Process running with session ID 123",
      }),
      row("response_item", {
        type: "function_call",
        name: "write_stdin",
        call_id: "poll",
        arguments: { session_id: 123 },
      }),
      row("response_item", {
        type: "function_call_output",
        call_id: "poll",
        output: [
          {
            type: "text",
            text: "Process exited with code 3\nOutput:\nBuild failed",
          },
        ],
      }),
    ].join("\n"),
  );
  const [session] = (await scanCodex({ home, cache: false })).sessions;
  expect(session.commands).toMatchObject([
    { command: "pnpm build", exitCode: 3, kind: "build" },
  ]);
  expect(session.state).toBe("warn");
});

test("aggregates only novel fork usage and defers unmatched parent evidence", async () => {
  const token = (increment: number, total: number) =>
    row("event_msg", {
      type: "token_count",
      info: {
        last_token_usage: { total_tokens: increment },
        total_token_usage: { total_tokens: total },
      },
    });
  const put = (name: string, lines: string[]) =>
    writeFile(join(sessions, name + ".jsonl"), lines.join("\n") + "\n");
  await put("parent", [meta("parent"), token(3, 3), token(2, 5)]);
  await put("copied", [
    meta("copied", { forked_from_id: "parent" }),
    token(3, 3),
    token(2, 5),
    token(4, 9),
  ]);
  await put("fresh", [
    meta("fresh", { forked_from_id: "parent" }),
    token(7, 12),
  ]);
  await put("missing", [
    meta("missing", { forked_from_id: "absent" }),
    token(6, 6),
  ]);
  const result = await scanCodex({ home, cache: false });
  const find = (id: string) =>
    result.sessions.find((session) => session.id === id);
  expect(find("copied")).toMatchObject({
    usage: { total: 9 },
    forkAggregate: { inFile: { total: 4 }, excludedSignatures: 2 },
  });
  expect(find("fresh")).toMatchObject({
    usage: { total: 7 },
    forkAggregate: { inFile: { total: 7 }, excludedSignatures: 0 },
  });
  expect(find("missing")?.forkAggregate).toBeUndefined();
  expect(result.usage).toMatchObject({ total: 16, quality: "approx" });
});

test("retains prior assistant open items and the last forty structured command lines", async () => {
  const fake = "ghp_" + "x".repeat(32);
  await writeFile(
    join(sessions, "handoff.jsonl"),
    [
      meta("handoff-example"),
      row("response_item", {
        type: "message",
        role: "assistant",
        phase: "commentary",
        content: [
          { text: "Should we verify the fixture?\nTODO: redact " + fake },
        ],
      }),
      row("response_item", {
        type: "message",
        role: "assistant",
        phase: "final",
        content: [{ text: "The fixture was updated." }],
      }),
      row("event_msg", {
        type: "item_completed",
        item: {
          type: "CommandExecution",
          id: "recent",
          command: "pnpm test",
          aggregated_output:
            Array.from({ length: 43 }, (_, i) => "fixture line " + i).join(
              "\n",
            ) +
            "\n" +
            fake +
            "\n",
        },
      }),
      row("response_item", {
        type: "function_call_output",
        call_id: "recent",
        output: "Process exited with code 8",
      }),
    ].join("\n"),
  );
  const [session] = (await scanCodex({ home, cache: false })).sessions;
  expect(session.finalAssistantText).toBe("The fixture was updated.");
  expect(session.assistantOpenItems?.map(({ text }) => text)).toEqual([
    "Should we verify the fixture?",
    "TODO: redact [REDACTED:github-token]",
  ]);
  expect(session.commands[0].exitCode).toBe(8);
  expect(session.commands[0].structured?.exitCode).toBeUndefined();
  const lines = session.commands[0].structured?.outputTail?.split("\n");
  expect(lines).toHaveLength(40);
  expect(lines?.[0]).toBe("fixture line 4");
  expect(lines?.at(-1)).toBe("[REDACTED:github-token]");
  expect(JSON.stringify(session)).not.toContain(fake);
});

test("read-only scans reuse compatible entries and leave misses unwritten", async () => {
  const cacheHome = join(scratch, "cache-home");
  await writeFile(join(sessions, "first.jsonl"), meta("first") + "\n");
  await scanCodex({ home, cacheHome });
  const directory = join(cacheHome, "cache");
  const previous = await readdir(directory);
  await writeFile(join(sessions, "second.jsonl"), meta("second") + "\n");
  const result = await scanCodex({ home, cacheHome, cache: "read-only" });
  expect(result.doctor.cache).toMatchObject({ hits: 1, misses: 1 });
  expect(result.sessions).toHaveLength(2);
  expect(await readdir(directory)).toEqual(previous);
});

test("a redaction rule revision invalidates otherwise identical cache keys", async () => {
  const cacheHome = join(scratch, "cache-home");
  await writeFile(join(sessions, "first.jsonl"), meta("first") + "\n");
  const [ref] = await new CodexReader().discover(home);
  const [session] = (await scanCodex({ home, cache: false })).sessions;
  const original = await SessionCache.open(home, "decoder", cacheHome, "v1");
  const changed = await SessionCache.open(home, "decoder", cacheHome, "v2");
  await original.write(ref, session);
  expect(await original.read(ref)).toEqual(session);
  expect(await changed.read(ref)).toBeUndefined();
});

test("reads session metadata and the tail around a generated compressed oversized record", async () => {
  const file = join(sessions, "generated-oversized.jsonl.zst");
  const zlib = await import("node:zlib");
  const { oversizedSessionFrame } =
    await import("../../../scripts/fixture-zstd.mjs");
  await writeFile(file, oversizedSessionFrame());
  for (const decoder of ["js", "native"] as const) {
    if (
      decoder === "native" &&
      typeof Reflect.get(zlib, "createZstdDecompress") !== "function"
    )
      continue;
    const result = await scanCodex({ home, cache: false, decoder });
    expect(result.doctor).toMatchObject({ parsedFiles: 1, oversizedLines: 1 });
    expect(result.sessions[0].parse.recordTypes.event_msg).toBe(1);
  }
});
