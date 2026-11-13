import { hashId } from "./layout.js";
import type { MapData, MapEdge, MapSession, Status } from "./types.js";

const names = [
  "auth/session",
  "payments/webhooks",
  "tests/integration",
  "docs/guide",
  "payments/webhooks",
  "src/components",
];
const titles = [
  "Session renewal",
  "Retry queue",
  "Signature checks",
  "Release notes",
  "Webhook delivery",
  "Account settings",
];
const statuses: Status[] = ["done", "done", "open", "warn", "done", "idle"];

export function demoData(count = 28): MapData {
  const lanes = names.map((name, index) => ({ id: "lane-" + index, name }));
  const sessions: MapSession[] = [];
  const edges: MapEdge[] = [];
  const previous = new Map<string, MapSession>();
  for (let index = 0; index < count; index++) {
    const laneIndex = index % lanes.length;
    const round = Math.floor(index / lanes.length);
    const lane = lanes[laneIndex].id;
    const id = "demo-" + String(index + 1).padStart(4, "0");
    const startedAt = new Date(
      Date.UTC(2026, 9, 14) +
        (index * 4 + Math.floor(index / 9) * 120) * 3600000,
    ).toISOString();
    const parent = round % 4 === 3 ? previous.get(lane) : undefined;
    const total = 15000 + (hashId(id) % 272000);
    const input = Math.floor(total * 0.82);
    const session: MapSession = {
      id,
      jitter: hashId(id),
      title: titles[laneIndex] + " · " + (index + 1),
      startedAt,
      endedAt: startedAt,
      status: statuses[index % statuses.length],
      lane,
      ...(parent ? { subagentOf: parent.id } : {}),
      usage: {
        total,
        input,
        output: total - input,
        approximate: index % 11 === 0,
      },
      ...(index % 9 === 0 ? { threadCumulative: total * 2 } : {}),
      fileCount: 1,
      files: [lanes[laneIndex].name + "/example.ts"],
    };
    if (parent)
      edges.push({
        from: parent.id,
        to: id,
        kind: "subagent",
        evidence: ["parent_thread_id"],
      });
    else {
      const prior = previous.get(lane);
      if (prior)
        edges.push({
          from: prior.id,
          to: id,
          kind: "shared-file",
          evidence: session.files,
        });
      previous.set(lane, session);
    }
    sessions.push(session);
  }
  return {
    demo: true,
    projects: [{ label: "Synthetic workspace", lanes, sessions, edges }],
  };
}
