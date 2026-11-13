import { NAMING } from "./naming.js";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { redact } from "./redact.js";
import { object } from "./types.js";

export interface LaneOverrides {
  rename: ReadonlyMap<string, string>;
  move: ReadonlyMap<string, string>;
}

function entries(value: unknown) {
  return Object.entries(object(value)).flatMap(([key, item]) =>
    typeof item === "string" && item.trim()
      ? [[key, item.trim()] as const]
      : [],
  );
}

export async function readOverrides(
  repoRoot: string,
): Promise<LaneOverrides | undefined> {
  try {
    const parsed = object(
      JSON.parse(
        await readFile(
          join(repoRoot, NAMING.repositoryDirectory, "overrides.json"),
          "utf8",
        ),
      ),
    );
    return {
      rename: new Map(
        entries(parsed.rename).map(([id, name]) => [
          id,
          redact(name)
            .replace(/\p{Cc}/gu, " ")
            .slice(0, 120),
        ]),
      ),
      move: new Map(entries(parsed.move)),
    };
  } catch {
    return;
  }
}
