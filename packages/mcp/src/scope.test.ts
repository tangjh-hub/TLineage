import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { historyNotice } from "./privacy.js";
import { createTools } from "./tools.js";

test("limits tool arguments and IDs to the startup repository unless all projects is explicit", async () => {
  const root = await mkdtemp(join(tmpdir(), "tlineage-scope-"));
  try {
    const home = join(root, "agent");
    const first = join(root, "repo");
    const second = join(root, "repo-other");
    const nested = join(first, "nested");
    await mkdir(join(home, "sessions"), { recursive: true });
    for (const dir of [first, second, nested])
      await mkdir(join(dir, ".git"), { recursive: true });
    const sub = join(first, "src");
    await mkdir(sub);
    const link = join(first, "link");
    await symlink(second, link, "junction");
    const at = "2000-01-01T00:00:00Z";
    for (const [id, cwd] of [
      ["local", first],
      ["foreign", second],
      ["nested", nested],
    ]) {
      await writeFile(
        join(home, "sessions", id + ".jsonl"),
        [
          { type: "session_meta", timestamp: at, payload: { id, cwd } },
          {
            type: "response_item",
            timestamp: at,
            payload: {
              type: "message",
              role: "user",
              content: [{ text: "needle" }],
            },
          },
        ]
          .map((value) => JSON.stringify(value))
          .join("\n"),
      );
    }

    const call = createTools({ home, cwd: sub });
    const search = await call("tlineage_search", { query: "needle", cwd: "." });
    expect(search.content[0].text).toContain('"id":"local"');
    expect(search.content[0].text).not.toMatch(/foreign|nested/);
    for (const cwd of [second, link, nested, "../nested"]) {
      const answer = await call("tlineage_search", { query: "needle", cwd });
      expect(answer.isError).toBe(true);
      expect(answer.content[0].text).toBe(
        historyNotice +
          "\nRequested directory is outside the allowed Git repository.",
      );
      expect(answer.content[0].text).not.toContain(root);
    }
    for (const [name, args] of [
      ["tlineage_get_session", { sessionId: "foreign", section: "summary" }],
      ["tlineage_handoff", { sessionId: "foreign" }],
    ] as const) {
      const result = await call(name, args);
      expect(result.isError).toBe(true);
      expect(result.content[0].text).not.toMatch(/foreign|repo-other/);
    }
    const unscoped = createTools({ home, cwd: root });
    expect(
      (await unscoped("tlineage_search", { query: "needle" })).isError,
    ).toBe(true);
    const global = createTools({ home, cwd: root, allProjects: true });
    expect(
      (
        await global("tlineage_get_session", {
          sessionId: "foreign",
          section: "summary",
        })
      ).content[0].text,
    ).toContain('"id":"foreign"');
    expect(
      (await global("tlineage_search", { query: "needle", cwd: second }))
        .content[0].text,
    ).toContain('"id":"foreign"');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
