import { byId, compareTime } from "./lanes.js";
import { touchedPath } from "./repositories.js";
import type { Session, SessionParent } from "./types.js";

type LinkEvidence =
  | {
      source: "session_meta";
      field?: SessionParent["field"];
      sessionId: string;
    }
  | { source: "FileChange"; files: string[] };

export interface Relationship {
  from: string;
  to: string;
  kind: "fork" | "subagent" | "shared-file";
  provenance: "verified";
  evidence: LinkEvidence;
}

export function relationships(sessions: readonly Session[]): Relationship[] {
  const bySession = new Map(sessions.map((session) => [session.id, session]));
  const result: Relationship[] = [];
  const files = new Map<string, Set<string>>();
  const modified = new Map<string, Map<string, string>>();
  for (const session of sessions) {
    const paths = new Map<string, string>();
    modified.set(session.id, paths);
    for (const touch of session.filesTouched) {
      if (!touch.fileChangeModified || touch.provenance !== "verified")
        continue;
      const path = touchedPath(session, touch.path);
      if (!path) continue;
      paths.set(path.absolute, path.relative);
      const owners = files.get(path.absolute) ?? new Set<string>();
      files.set(path.absolute, owners);
      owners.add(session.id);
    }
  }
  for (const target of sessions) {
    const seen = new Set<string>();
    for (const link of target.parents) {
      const key = JSON.stringify([link.kind, link.sessionId]);
      if (
        link.provenance !== "verified" ||
        link.sessionId === target.id ||
        !bySession.has(link.sessionId) ||
        seen.has(key)
      )
        continue;
      seen.add(key);
      result.push({
        from: link.sessionId,
        to: target.id,
        kind: link.kind,
        provenance: "verified",
        evidence: {
          source: "session_meta",
          field: link.field,
          sessionId: target.id,
        },
      });
    }

    if (!Number.isFinite(Date.parse(target.startedAt))) continue;
    const candidates = new Map<string, Set<string>>();
    for (const [absolute, path] of modified.get(target.id)!) {
      for (const id of files.get(absolute)!) {
        const source = bySession.get(id)!;
        if (
          id === target.id ||
          !Number.isFinite(Date.parse(source.endedAt)) ||
          compareTime(source.endedAt, target.startedAt) >= 0
        )
          continue;
        const paths = candidates.get(id) ?? new Set<string>();
        paths.add(path);
        candidates.set(id, paths);
      }
    }
    const strongest = [...candidates]
      .sort(([a, paths], [b, others]) => others.size - paths.size || byId(a, b))
      .slice(0, 2);
    for (const [from, paths] of strongest) {
      result.push({
        from,
        to: target.id,
        kind: "shared-file",
        provenance: "verified",
        evidence: { source: "FileChange", files: [...paths].sort(byId) },
      });
    }
  }
  return result.sort(
    (a, b) => byId(a.to, b.to) || byId(a.kind, b.kind) || byId(a.from, b.from),
  );
}
