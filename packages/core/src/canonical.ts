import type { Session } from "./types.js";

const fraction = (time: string) =>
  /\.(\d{1,9})/.exec(time)?.[1].padEnd(9, "0") ?? "000000000";

export function canonicalSessions(files: readonly Session[]): Session[] {
  const groups = new Map<string, Session[]>();
  for (const session of files) {
    const key = `${session.agent}:${session.id}`;
    const group = groups.get(key) ?? [];
    group.push(session);
    groups.set(key, group);
  }

  const selected: Session[] = [];
  for (const group of groups.values()) {
    group.sort((a, b) => {
      const aTime = Date.parse(a.parse.lastRecordAt);
      const bTime = Date.parse(b.parse.lastRecordAt);
      const dateOrder =
        (Number.isFinite(bTime) ? bTime : -Infinity) -
        (Number.isFinite(aTime) ? aTime : -Infinity);
      if (dateOrder) return dateOrder;
      const aFraction = fraction(a.parse.lastRecordAt);
      const bFraction = fraction(b.parse.lastRecordAt);
      if (aFraction !== bFraction) return aFraction > bFraction ? -1 : 1;
      const lineOrder = b.parse.lineCount - a.parse.lineCount;
      if (lineOrder) return lineOrder;
      const aPath = a.files[0].path;
      const bPath = b.files[0].path;
      return aPath < bPath ? -1 : aPath > bPath ? 1 : 0;
    });
    const [canonical, ...others] = group;
    selected.push({
      ...canonical,
      alternates: others.flatMap((other) => other.files),
    });
  }
  return selected.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
