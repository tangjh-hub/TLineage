import type { LaneOverrides } from "./overrides.js";
import { touchedPath } from "./repositories.js";
import type { Session } from "./types.js";

export interface Lane {
  id: string;
  name: string;
  nameSource: "paths" | "message" | "misc" | "override";
  sessions: Session[];
}

const fortnight = 14n * 86400000n * 1000000n;
export const byId = (left: string, right: string) =>
  left < right ? -1 : left > right ? 1 : 0;
function instant(time: string) {
  const millis = Date.parse(time);
  if (!Number.isFinite(millis)) return;
  const fraction = /\.(\d{1,9})/.exec(time)?.[1].padEnd(9, "0") ?? "000000000";
  return BigInt(millis) * 1000000n + BigInt(fraction.slice(3));
}
export function compareTime(left: string, right: string) {
  const a = instant(left);
  const b = instant(right);
  if (a === undefined) return b === undefined ? 0 : 1;
  if (b === undefined) return -1;
  return a < b ? -1 : a > b ? 1 : 0;
}
export const orderSessions = (left: Session, right: Session) =>
  compareTime(left.startedAt, right.startedAt) || byId(left.id, right.id);

function pathPrefixes(session: Session) {
  const paths = new Set(
    session.filesTouched.flatMap(({ path }) => {
      const entry = touchedPath(session, path);
      return entry ? [entry.relative] : [];
    }),
  );
  return [...paths].map(
    (path) => path.split("/").slice(0, -1).slice(0, 2).join("/") || ".",
  );
}

interface Group {
  sessions: Session[];
  prefixes: Set<string>;
  intervals: { start: bigint; end: bigint }[];
}

function merge(target: Group, source: Group) {
  target.sessions.push(...source.sessions);
  target.intervals.push(...source.intervals);
  for (const prefix of source.prefixes) target.prefixes.add(prefix);
}

function similar(left: Group, right: Group) {
  let common = 0;
  for (const prefix of left.prefixes) if (right.prefixes.has(prefix)) common++;
  const union = left.prefixes.size + right.prefixes.size - common;
  return (
    union > 0 &&
    common * 2 >= union &&
    left.intervals.some((a) =>
      right.intervals.some(
        (b) => a.start - b.end <= fortnight && b.start - a.end <= fortnight,
      ),
    )
  );
}

function laneName(
  sessions: Session[],
  prefixes: ReadonlyMap<string, string[]>,
  misc: boolean,
): Pick<Lane, "name" | "nameSource"> {
  const counts = new Map<string, number>();
  for (const session of sessions) {
    for (const prefix of prefixes.get(session.id) ?? [])
      counts.set(prefix, (counts.get(prefix) ?? 0) + 1);
  }
  const mostCommon = [...counts].sort(
    ([a, n], [b, m]) => m - n || byId(a, b),
  )[0]?.[0];
  if (mostCommon) return { name: mostCommon, nameSource: "paths" };
  const text = Array.from(sessions[0].userMessages[0]?.text ?? "")
    .slice(0, 20)
    .join("")
    .replace(/\s+/g, " ")
    .trim();
  return !misc && text
    ? { name: text, nameSource: "message" }
    : { name: "杂项", nameSource: "misc" };
}

export function clusterLanes(
  input: readonly Session[],
  overrides?: LaneOverrides,
): Lane[] {
  const sessions = [...input].sort((a, b) => byId(a.id, b.id));
  const roots = new Map(sessions.map((session) => [session.id, session.id]));
  const root = (id: string) => {
    let current = id;
    while (roots.get(current) !== current) current = roots.get(current)!;
    roots.set(id, current);
    return current;
  };
  for (const session of sessions) {
    for (const link of session.parents) {
      if (link.provenance !== "verified" || !roots.has(link.sessionId))
        continue;
      const a = root(session.id);
      const b = root(link.sessionId);
      if (a !== b) roots.set(byId(a, b) < 0 ? b : a, byId(a, b) < 0 ? a : b);
    }
  }
  const structural = new Map<string, Group>();
  const prefixes = new Map<string, string[]>();
  for (const session of sessions) {
    const key = root(session.id);
    const group = structural.get(key) ?? {
      sessions: [],
      prefixes: new Set<string>(),
      intervals: [],
    };
    structural.set(key, group);
    const paths = pathPrefixes(session);
    prefixes.set(session.id, paths);
    group.sessions.push(session);
    for (const path of paths) group.prefixes.add(path);
    const start = instant(session.startedAt);
    const end = instant(session.endedAt);
    if (start !== undefined && end !== undefined && end >= start)
      group.intervals.push({ start, end });
  }

  const groups = [...structural.values()];
  const misc = new Map<string, Group>();
  for (let index = 0; index < groups.length;) {
    const group = groups[index];
    if (group.prefixes.size) {
      index++;
      continue;
    }
    const branches = new Set(
      group.sessions.map((session) => session.gitBranch ?? ""),
    );
    if (branches.size !== 1) {
      index++;
      continue;
    }
    const branch = [...branches][0];
    const existing = misc.get(branch);
    if (existing) {
      merge(existing, group);
      groups.splice(index, 1);
    } else {
      misc.set(branch, group);
      index++;
    }
  }

  // Recheck pairs after each merge because a union can change Jaccard similarity.
  for (;;) {
    let matched = false;
    for (let i = 0; i < groups.length && !matched; i++) {
      for (let j = i + 1; j < groups.length; j++) {
        if (!similar(groups[i], groups[j])) continue;
        merge(groups[i], groups[j]);
        groups.splice(j, 1);
        matched = true;
        break;
      }
    }
    if (!matched) break;
  }

  const lanes = groups.map((group) => {
    const members = group.sessions.sort(orderSessions);
    return {
      id: "lane:" + members.map((s) => s.id).sort(byId)[0],
      members,
      misc: [...misc.values()].includes(group),
    };
  });
  const byLane = new Map(lanes.map((lane) => [lane.id, [] as Session[]]));
  for (const lane of lanes) {
    for (const session of lane.members) {
      const destination = overrides?.move.get(session.id);
      (byLane.get(destination ?? "") ?? byLane.get(lane.id)!).push(session);
    }
  }
  return lanes
    .flatMap((lane) => {
      const members = byLane.get(lane.id)!.sort(orderSessions);
      if (!members.length) return [];
      const name = overrides?.rename.get(lane.id);
      const label = name
        ? { name, nameSource: "override" as const }
        : laneName(members, prefixes, lane.misc);
      return [{ id: lane.id, ...label, sessions: members }];
    })
    .sort(
      (a, b) =>
        compareTime(a.sessions[0].startedAt, b.sessions[0].startedAt) ||
        byId(a.id, b.id),
    );
}
