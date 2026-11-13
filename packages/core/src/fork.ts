import { stat } from "node:fs/promises";
import { oversizedHeader } from "./codex.js";
import { readLines, type ReadOptions } from "./lines.js";
import { object, type SessionFileRef } from "./types.js";
import { tokenRecordSignature } from "./usage.js";

export async function sameFile(ref: SessionFileRef): Promise<boolean> {
  try {
    const current = await stat(ref.path);
    return current.size === ref.sizeBytes && current.mtimeMs === ref.mtimeMs;
  } catch {
    return false;
  }
}

const maxSignatures = 100_000;

export async function readForkSignatures(
  ref: SessionFileRef,
  options: ReadOptions,
): Promise<string[] | undefined> {
  const keys = new Set<string>();
  if (!(await sameFile(ref))) return;
  try {
    for await (const line of readLines(ref.path, options)) {
      if (line.oversized) {
        const { type } = oversizedHeader(line.text);
        if (
          !type ||
          type === "event_msg" ||
          type === "token_usage_record" ||
          type === "session_meta"
        )
          return;
        continue;
      }
      if (!line.text.trim()) continue;
      const row = object(JSON.parse(line.text));
      const key = tokenRecordSignature(row.type, object(row.payload));
      if (key === null) return;
      if (key) keys.add(key);
      if (keys.size > maxSignatures) return;
    }
    if (keys.size && (await sameFile(ref))) return [...keys];
  } catch {
    // A file that could not be read in full is insufficient evidence for deductions.
  }
}

export function forkPrefix(
  child: readonly string[],
  parent: readonly string[],
): ReadonlySet<string> | undefined {
  if (!child.length || !parent.length) return;
  const positions = new Map(parent.map((key, index) => [key, index]));
  const matching = child.filter((key) => positions.has(key));
  if (!matching.length) return new Set();
  const first = positions.get(child[0]);
  if (first === undefined || matching.length < 2) return;
  const prefix = child.slice(0, matching.length);
  if (prefix.every((key, index) => parent[first + index] === key))
    return new Set(prefix);
}
