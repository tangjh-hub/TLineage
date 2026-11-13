import type { Filter, MapProject, MapSession, MapUsage } from "./types.js";

const day = 86_400_000;
export const laneHeight = 90;
export const clusterDistance = 14;
export const defaultListLimit = 500;
export const order = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
export const chronological = (a: MapSession, b: MapSession) =>
  order(a.startedAt || "~", b.startedAt || "~") || order(a.id, b.id);

export function hashId(id: string) {
  let hash = 2166136261;
  for (let index = 0; index < id.length; index++)
    hash = Math.imul(hash ^ id.charCodeAt(index), 16777619);
  return hash >>> 0;
}

export const jitter = (hash: number) => (hash % 33) - 16;
export const radius = (tokens: number) =>
  Math.max(3, Math.min(12, 2.5 + Math.sqrt(Math.max(0, tokens) / 1000) * 0.45));

export function timeAxis(values: readonly string[]) {
  const times = [
    ...new Set(
      values.map((value) => Date.parse(value)).filter(Number.isFinite),
    ),
  ].sort((a, b) => a - b);
  const positions = new Map<number, number>();
  const segments: {
    from: number;
    to: number;
    x: number;
    width: number;
    compressed: boolean;
  }[] = [];
  let span = 0;
  for (let index = 0; index < times.length; index++) {
    const to = times[index];
    if (index) {
      const from = times[index - 1];
      const compressed = to - from > 3 * day;
      const width = compressed ? day : to - from;
      segments.push({ from, to, x: span, width, compressed });
      span += width;
    }
    positions.set(to, span);
  }
  return { times, positions, segments, span };
}

export function timeTicks(axis: ReturnType<typeof timeAxis>, count = 7) {
  if (!axis.times.length) return [];
  const from = axis.times[0];
  const to = axis.times.at(-1)!;
  const target = axis.span / Math.max(1, count - 1);
  const steps = [
    3600000,
    10800000,
    21600000,
    43200000,
    day,
    2 * day,
    3 * day,
    7 * day,
    14 * day,
    30 * day,
    90 * day,
  ];
  const step =
    steps.find((value) => value >= target) ??
    Math.max(1, Math.ceil(target / day)) * day;
  const ticks = [{ time: from, x: 0 }];
  for (const segment of axis.segments) {
    if (segment.compressed) continue;
    for (
      let at = Math.ceil(segment.from / step) * step;
      at < segment.to;
      at += step
    ) {
      if (at <= from) continue;
      ticks.push({ time: at, x: segment.x + at - segment.from });
    }
  }
  if (to > from) ticks.push({ time: to, x: axis.span });
  return ticks;
}

const zero = (approximate = false): MapUsage => ({
  total: 0,
  input: 0,
  output: 0,
  approximate,
});
const plus = (a: MapUsage, b: MapUsage): MapUsage => ({
  total: a.total + b.total,
  input: a.input + b.input,
  output: a.output + b.output,
  approximate: a.approximate || b.approximate,
});
const effective = (s: MapSession) =>
  s.contribution === null ? zero(true) : (s.contribution ?? s.usage);

export function foldSubagents(sessions: readonly MapSession[]) {
  const byId = new Map(sessions.map((session) => [session.id, session]));
  const parents = new Map<string, string>();
  for (const session of sessions) {
    if (
      session.subagentOf &&
      session.subagentOf !== session.id &&
      byId.has(session.subagentOf)
    ) {
      parents.set(session.id, session.subagentOf);
    }
  }
  // A malformed cycle stays visible and cannot contribute twice.
  const visited = new Set<string>();
  for (const id of parents.keys()) {
    const path = new Set<string>();
    let current: string | undefined = id;
    while (current && !visited.has(current)) {
      if (path.has(current)) {
        let member = current;
        do {
          const next = parents.get(member)!;
          parents.delete(member);
          member = next;
        } while (member !== current);
        break;
      }
      path.add(current);
      current = parents.get(current);
    }
    for (const item of path) visited.add(item);
  }
  const children = new Map<string, string[]>();
  const totals = new Map(
    sessions.map((session) => [
      session.id,
      { usage: effective(session), count: 0 },
    ]),
  );
  for (const [child, parent] of parents) {
    const list = children.get(parent) ?? [];
    list.push(child);
    children.set(parent, list);
  }
  const remaining = new Map(
    [...children].map(([id, list]) => [id, list.length]),
  );
  const leaves = sessions
    .filter(({ id }) => !remaining.has(id))
    .map(({ id }) => id);
  for (let index = 0; index < leaves.length; index++) {
    const id = leaves[index];
    const parent = parents.get(id);
    if (!parent) continue;
    const child = totals.get(id)!;
    const target = totals.get(parent)!;
    target.usage = plus(target.usage, child.usage);
    target.count += child.count + 1;
    const left = remaining.get(parent)! - 1;
    remaining.set(parent, left);
    if (left === 0) leaves.push(parent);
  }
  return { parents, totals };
}

export function matchesFilter(session: MapSession, filter: Filter) {
  if (filter === "all") return true;
  if (filter === "active")
    return session.status === "open" || session.status === "warn";
  return session.status === (filter === "stalled" ? "idle" : "done");
}

export function visibleSessions(
  project: MapProject,
  showSubagents: boolean,
  filter: Filter,
  folded = foldSubagents(project.sessions),
) {
  return project.sessions
    .filter(
      (session) =>
        (showSubagents || !folded.parents.has(session.id)) &&
        matchesFilter(session, filter),
    )
    .sort(chronological);
}

export function initialSession(sessions: readonly MapSession[]) {
  const sorted = [...sessions].sort(chronological);
  return (
    sorted.filter((session) => matchesFilter(session, "active")).at(-1) ??
    sorted.at(-1)
  )?.id;
}

export function laneLabels(project: MapProject) {
  const first = new Map<string, string>();
  for (const session of [...project.sessions].sort(chronological)) {
    if (!first.has(session.lane)) first.set(session.lane, session.startedAt);
  }
  const counts = new Map<string, number>();
  for (const { name } of project.lanes)
    counts.set(name, (counts.get(name) ?? 0) + 1);
  const labels = new Map<string, string>();
  for (const { id, name } of project.lanes) {
    const time = Date.parse(first.get(id) ?? "");
    const date = Number.isFinite(time)
      ? new Date(time).toISOString().slice(5, 10).replace("-", "/")
      : "—";
    labels.set(id, counts.get(name) === 1 ? name : `${name} · ${date}`);
  }
  const collisions = new Map<string, string[]>();
  for (const [id, label] of labels) {
    const items = collisions.get(label) ?? [];
    items.push(id);
    collisions.set(label, items);
  }
  const used = new Set(labels.values());
  for (const [label, ids] of collisions) {
    if (ids.length < 2) continue;
    ids.sort(order).forEach((id, index) => {
      let suffix = index + 1;
      while (used.has(`${label} #${suffix}`)) suffix++;
      const unique = `${label} #${suffix}`;
      used.add(unique);
      labels.set(id, unique);
    });
  }
  return labels;
}

export interface Star {
  session: MapSession;
  x: number;
  y: number;
  r: number;
  usage: MapUsage;
}
export interface Camera {
  zoom: number;
  x: number;
  y: number;
}
export const resetCamera: Camera = { zoom: 1, x: 0, y: 0 };

export const laneColumnWidth = (width: number) =>
  Math.min(184, Math.max(66, width * 0.24));

export function mapLayout(
  sessions: readonly MapSession[],
  laneIds: readonly string[],
  folded: ReturnType<typeof foldSubagents>,
  showSubagents: boolean,
  width: number,
  height: number,
  camera: Camera,
) {
  const axis = timeAxis(sessions.map((session) => session.startedAt));
  const left = laneColumnWidth(width);
  const right = 32;
  const top = 20;
  const bottom = 48;
  const xWidth = Math.max(1, width - left - right);
  const yHeight = Math.max(1, height - top - bottom);
  const laneScale = Math.min(
    1,
    yHeight / (Math.max(1, laneIds.length) * laneHeight),
  );
  const bands = new Map(
    laneIds.map((id, index) => [id, (index + 0.5) * laneHeight]),
  );
  const projectX = (unit: number) =>
    left +
    (axis.span ? unit / axis.span : 0.5) * xWidth * camera.zoom +
    camera.x;
  const projectY = (unit: number) =>
    top + unit * laneScale * camera.zoom + camera.y;
  const stars = sessions.map((session): Star => {
    const usage = showSubagents
      ? effective(session)
      : (folded.totals.get(session.id)?.usage ?? effective(session));
    return {
      session,
      x: projectX(
        axis.positions.get(Date.parse(session.startedAt)) ?? axis.span,
      ),
      y: projectY(
        (bands.get(session.lane) ?? laneHeight / 2) + jitter(session.jitter),
      ),
      r: radius(usage.total),
      usage,
    };
  });
  return {
    stars,
    left,
    axisY: height - 31,
    bands: [...bands].map(([id, y]) => ({ id, y: projectY(y) })),
    ticks: timeTicks(axis, Math.max(3, Math.floor(xWidth / 95))).map(
      ({ time, x }) => ({ time, x: projectX(x) }),
    ),
    breaks: axis.segments
      .filter((segment) => segment.compressed)
      .map((segment) => projectX(segment.x + segment.width / 2)),
  };
}

export interface PlotNode {
  id: string;
  stars: Star[];
  x: number;
  y: number;
  r: number;
  lane: string;
}

export function clusters(
  stars: readonly Star[],
  expanded: ReadonlySet<string> = new Set(),
): PlotNode[] {
  const sorted = [...stars].sort((a, b) => chronological(a.session, b.session));
  const parents = sorted.map((_, index) => index);
  const root = (index: number) => {
    while (parents[index] !== index) {
      parents[index] = parents[parents[index]];
      index = parents[index];
    }
    return index;
  };
  const cells = new Map<string, number[]>();
  sorted.forEach((star, index) => {
    const cellX = Math.floor(star.x / clusterDistance);
    const cellY = Math.floor(star.y / clusterDistance);
    const key = (x: number, y: number) => `${star.session.lane}:${x}:${y}`;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const other of cells.get(key(cellX + dx, cellY + dy)) ?? []) {
          if (
            Math.hypot(star.x - sorted[other].x, star.y - sorted[other].y) <
            clusterDistance
          ) {
            const a = root(index);
            const b = root(other);
            if (a !== b) parents[Math.max(a, b)] = Math.min(a, b);
          }
        }
      }
    }
    const cell = key(cellX, cellY);
    const list = cells.get(cell) ?? [];
    list.push(index);
    cells.set(cell, list);
  });
  const groups = new Map<number, Star[]>();
  sorted.forEach((star, index) => {
    const group = root(index);
    const list = groups.get(group) ?? [];
    list.push(star);
    groups.set(group, list);
  });
  const node = (star: Star): PlotNode => ({
    id: star.session.id,
    stars: [star],
    x: star.x,
    y: star.y,
    r: star.r,
    lane: star.session.lane,
  });
  return [...groups.values()]
    .flatMap((group) => {
      if (group.length === 1) return [node(group[0])];
      const id =
        "cluster-" +
        group[0].session.id +
        "-" +
        hashId(group.map((star) => star.session.id).join(","));
      const x = group.reduce((sum, star) => sum + star.x, 0) / group.length;
      const y = group.reduce((sum, star) => sum + star.y, 0) / group.length;
      if (expanded.has(id)) {
        const spread = Math.max(24, group.length * 3.5);
        return group.map((star, index) => {
          const angle = (index * 2 * Math.PI) / group.length - Math.PI / 2;
          return {
            ...node(star),
            x: x + spread * Math.cos(angle),
            y: y + spread * Math.sin(angle),
          };
        });
      }
      return [
        {
          id,
          stars: group,
          x,
          y,
          r: Math.min(17, 8 + Math.sqrt(group.length)),
          lane: group[0].session.lane,
        },
      ];
    })
    .sort((a, b) => chronological(a.stars[0].session, b.stars[0].session));
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}
export const overlap = (a: Box, b: Box) =>
  a.x < b.x + b.width &&
  a.x + a.width > b.x &&
  a.y < b.y + b.height &&
  a.y + a.height > b.y;

export function fitLaneLabel(
  text: string,
  width: number,
  measure: (value: string) => number,
) {
  if (measure(text) <= width) return text;
  const suffix = / · (?:\d{2}\/\d{2}|—)(?: #\d+)?$/.exec(text)?.[0] ?? "";
  if (suffix && measure("…" + suffix) > width) {
    const compact = suffix.slice(3);
    for (const candidate of ["…" + compact, compact, compact.split(" ")[0]]) {
      if (measure(candidate) <= width) return candidate;
    }
  }
  const prefix = Array.from(text.slice(0, text.length - suffix.length));
  while (prefix.length && measure(prefix.join("") + "…" + suffix) > width)
    prefix.pop();
  const label = prefix.join("") + "…" + suffix;
  return measure(label) <= width ? label : "…";
}

export function badges(
  nodes: readonly PlotNode[],
  text: (node: PlotNode) => string | undefined,
  measure: (value: string) => number,
  bounds: Box,
  selected?: string,
) {
  const candidates = [...nodes].sort(
    (a, b) =>
      Number(b.id === selected) - Number(a.id === selected) ||
      chronological(a.stars[0].session, b.stars[0].session),
  );
  const placed: (Box & { node: PlotNode; text: string })[] = [];
  const cores = nodes.map((node) => ({
    x: node.x - node.r - 1,
    y: node.y - node.r - 1,
    width: 2 * node.r + 2,
    height: 2 * node.r + 2,
  }));
  for (const node of candidates) {
    const caption = text(node);
    if (!caption) continue;
    const width = Math.ceil(measure(caption)) + 7;
    const height = 14;
    let found = false;
    for (const distance of [4, 9, 17, 27, 41]) {
      for (const vertical of [-1, 1]) {
        const y =
          vertical < 0
            ? node.y - node.r - distance - height
            : node.y + node.r + distance;
        for (const offset of [0, -18, 18, -34, 34, -52, 52]) {
          const x = Math.max(
            bounds.x,
            Math.min(
              bounds.x + bounds.width - width,
              node.x - width / 2 + offset,
            ),
          );
          const box = { x, y, width, height };
          if (
            y < bounds.y ||
            y + height > bounds.y + bounds.height ||
            x + width > bounds.x + bounds.width
          )
            continue;
          if (
            placed.some((other) => overlap(box, other)) ||
            cores.some((core) => overlap(box, core))
          )
            continue;
          placed.push({ ...box, node, text: caption });
          found = true;
          break;
        }
        if (found) break;
      }
      if (found) break;
    }
  }
  return placed;
}

export function labels(
  nodes: readonly PlotNode[],
  text: (node: PlotNode) => string,
  measure: (text: string) => number,
  bounds: Box,
  priority: readonly (string | undefined)[],
  reserved: readonly Box[] = [],
) {
  const singles = nodes.filter((node) => node.stars.length === 1);
  const byId = new Map(singles.map((node) => [node.id, node]));
  const top = [...singles]
    .sort(
      (a, b) =>
        b.stars[0].usage.total - a.stars[0].usage.total || order(a.id, b.id),
    )
    .slice(0, 12);
  const candidates = [
    ...new Set([
      ...priority.flatMap((id) => (id && byId.has(id) ? [byId.get(id)!] : [])),
      ...top,
    ]),
  ];
  const placed: (Box & { id: string; text: string })[] = [];
  for (const node of candidates) {
    const label = text(node);
    const width = Math.ceil(measure(label)) + 8;
    const height = 16;
    const gap = node.r + 5;
    const choices = [
      { x: node.x - width / 2, y: node.y + gap },
      { x: node.x - width / 2, y: node.y - gap - height },
      { x: node.x + gap, y: node.y - height / 2 },
      { x: node.x - gap - width, y: node.y - height / 2 },
      ...[12, 24, 36].flatMap((offset) => [
        { x: node.x - width / 2, y: node.y + gap + offset },
        { x: node.x - width / 2, y: node.y - gap - height - offset },
        { x: node.x + gap, y: node.y - height / 2 - offset },
        { x: node.x - gap - width, y: node.y - height / 2 + offset },
      ]),
    ];
    for (const { x, y } of choices) {
      const box = { x, y, width, height };
      if (
        x < bounds.x ||
        y < bounds.y ||
        x + width > bounds.x + bounds.width ||
        y + height > bounds.y + bounds.height
      )
        continue;
      if (
        placed.some((item) => overlap(item, box)) ||
        reserved.some((item) => overlap(item, box))
      )
        continue;
      if (
        nodes.some(
          (other) =>
            other.id !== node.id &&
            overlap(box, {
              x: other.x - other.r,
              y: other.y - other.r,
              width: other.r * 2,
              height: other.r * 2,
            }),
        )
      )
        continue;
      placed.push({ ...box, id: node.id, text: label });
      break;
    }
  }
  return placed;
}

export function neighbor(
  nodes: readonly PlotNode[],
  id: string,
  dx: number,
  dy: number,
) {
  const current = nodes.find((node) => node.id === id);
  if (!current) return;
  let result: { id: string; score: number } | undefined;
  for (const node of nodes) {
    const x = node.x - current.x;
    const y = node.y - current.y;
    const along = dx * x + dy * y;
    if (along <= 0) continue;
    const score = along + 2 * Math.abs(dx * y - dy * x);
    if (
      !result ||
      score < result.score ||
      (score === result.score && order(node.id, result.id) < 0)
    )
      result = { id: node.id, score };
  }
  return result?.id;
}

export function zoomCamera(
  camera: Camera,
  multiplier: number,
  anchorX: number,
  anchorY: number,
  width: number,
): Camera {
  const zoom = Math.max(0.5, Math.min(12, camera.zoom * multiplier));
  const factor = zoom / camera.zoom;
  const left = laneColumnWidth(width);
  const top = 20;
  return {
    zoom,
    x: anchorX - left - (anchorX - left - camera.x) * factor,
    y: anchorY - top - (anchorY - top - camera.y) * factor,
  };
}
