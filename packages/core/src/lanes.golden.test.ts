import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { buildGraphs, lanesJson } from "./graph.js";
import { redactTree } from "./redact.js";
import { scanCodex } from "./scan.js";

const fixture = new URL("../../../fixtures/codex-0.133.jsonl", import.meta.url);
const golden = new URL("../../../fixtures/lanes.golden.json", import.meta.url);

test("a sanitized fixture and synthetic sessions produce byte-stable lanes with evidence", async () => {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "tlineage-golden-")),
  );
  try {
    const checkout = join(root, "checkout");
    const linked = join(root, "linked");
    const git = join(checkout, ".git", "worktrees", "linked");
    const home = join(root, "codex");
    const sessions = join(home, "sessions");
    await mkdir(git, { recursive: true });
    await mkdir(linked);
    await mkdir(sessions, { recursive: true });
    await writeFile(join(linked, ".git"), `gitdir: ${git}\n`);
    await writeFile(join(git, "commondir"), "../..\n");

    const lines = (await readFile(fixture, "utf8")).trimEnd().split("\n");
    const metadata = JSON.parse(lines[0]);
    metadata.payload.cwd = checkout;
    lines[0] = JSON.stringify(metadata);
    await writeFile(join(sessions, "base.jsonl"), lines.join("\n"));

    const time = (day: string) => `2000-01-${day}T00:00:00.000Z`;
    const row = (timestamp: string, type: string, payload: object) =>
      JSON.stringify({ timestamp, type, payload });
    const change = (at: string) =>
      row(at, "event_msg", {
        type: "item_completed",
        item: {
          type: "FileChange",
          status: "completed",
          changes: { "src/core/main.ts": { type: "update" } },
        },
      });
    async function add(
      id: string,
      cwd: string,
      date: string,
      fileChange: boolean,
      parent?: string,
    ) {
      const when = time(date);
      const events = [
        row(when, "session_meta", {
          id,
          cwd,
          ...(parent ? { parent_thread_id: parent } : {}),
        }),
        row(when, "event_msg", {
          type: "token_count",
          info: {
            last_token_usage: { total_tokens: 5 },
            total_token_usage: { total_tokens: 5 },
          },
        }),
      ];
      if (fileChange) events.push(change(when));
      await writeFile(join(sessions, id + ".jsonl"), events.join("\n"));
    }
    await add("edit-a", checkout, "02", true);
    await add("edit-b", checkout, "03", true, "edit-a");
    await add("edit-linked", linked, "04", true);
    await add("misc", linked, "05", false);
    await mkdir(join(checkout, ".tlineage"));
    await writeFile(
      join(checkout, ".tlineage", "overrides.json"),
      JSON.stringify({
        rename: { "lane:edit-a": "合成主线" },
      }),
    );

    const scan = await scanCodex({ home, cache: false });
    const options = { cwd: linked, now: Date.parse(time("06")) };
    const serialize = async (input: typeof scan.sessions) => {
      const projects = lanesJson(await buildGraphs(input, options));
      return (
        JSON.stringify(
          redactTree({ schemaVersion: 1, projects }),
          null,
          2,
        ).replaceAll(root, "<synthetic>") + "\n"
      );
    };
    const first = await serialize(scan.sessions);
    expect(await serialize([...scan.sessions].reverse())).toBe(first);
    expect(first).toBe(await readFile(golden, "utf8"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
