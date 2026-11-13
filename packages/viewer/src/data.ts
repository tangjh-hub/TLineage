import { createHash } from "node:crypto";
import { homedir, userInfo } from "node:os";
import type { buildGraphs } from "../../core/src/graph.js";
import { buildHandoff } from "../../core/src/handoff.js";
import {
  readHandoffGit,
  type ReadHandoffGit,
} from "../../core/src/handoff-git.js";
import { redact } from "../../core/src/redact.js";
import { touchedPath } from "../../core/src/repositories.js";
import type { Session, UsageCounts } from "../../core/src/types.js";
import { hashId } from "./layout.js";
import type { MapData, MapProject, MapUsage } from "./types.js";

type Graph = Awaited<ReturnType<typeof buildGraphs>>[number];
const accountNames = [
  homedir().split(/[\\/]/).pop(),
  process.env.USER,
  process.env.USERNAME,
];
try {
  accountNames.push(userInfo().username);
} catch {
  /* Optional OS metadata. */
}
const escaped = [
  ...new Set(accountNames.filter((name): name is string => Boolean(name))),
].map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
const accounts = escaped.length
  ? new RegExp(
      `(^|[^\\p{L}\\p{N}_-])(?:${escaped.join("|")})(?=$|[^\\p{L}\\p{N}_-])`,
      "giu",
    )
  : undefined;
const pathText =
  /(?:[a-z][a-z0-9+.-]*:\/\/[^\s<>"'`]+|(?:^|[\s(<\[{"'`=：:])(?:~\/|\/|[a-z]:[\\/]|\\\\)[^\s<>"'`，。；、]+|[a-z]:\\[^\s<>"'`，。；、]+)/giu;
const email = /[\p{L}\p{N}_.%+-]+@[\p{L}\p{N}.-]+\.[a-z]{2,}/giu;
const safeId = (value: string) =>
  createHash("sha256").update(value).digest("hex").slice(0, 12);
const cap = (value: string, size: number) =>
  Array.from(value).slice(0, size).join("");

function safeText(value: string, size: number) {
  let clean = redact(value)
    .replace(pathText, " [PATH]")
    .replace(email, "[EMAIL]");
  if (accounts) clean = clean.replace(accounts, "$1[ACCOUNT]");
  return cap(clean.replace(/[\p{Cc}\p{Cf}\s]+/gu, " ").trim(), size);
}

function summary(session: Session) {
  const source = (
    session.finalAssistantText ||
    session.userMessages[0]?.text ||
    ""
  ).trim();
  // Leave short conversations out instead of embedding their complete text.
  if (Array.from(source).length <= 40) return;
  const firstLine = source.split(/\r?\n/, 1)[0];
  const preview = safeText(firstLine, 40);
  return preview && preview !== source ? preview : undefined;
}

function date(value: string) {
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : "";
}

function mapUsage(usage: UsageCounts, approximate: boolean): MapUsage {
  return {
    total: usage.total,
    input: usage.input,
    output: usage.output,
    approximate,
  };
}

function projectData(graph: Graph, redactTitles: boolean): MapProject {
  const short = (id: string) => safeId(id).slice(0, 8);
  const lanes = graph.lanes.map((lane) => ({
    id: safeId(lane.id),
    name:
      redactTitles && lane.nameSource === "message"
        ? short(lane.id)
        : safeText(lane.name, 80),
  }));
  const sessions = graph.lanes.flatMap((lane, index) =>
    lane.sessions.map((session) => {
      const approximate = session.usage.quality === "approx";
      const parent = session.parents.find(
        (link) =>
          link.kind === "subagent" &&
          link.provenance === "verified" &&
          link.sessionId !== session.id,
      );
      const contribution =
        session.parent?.kind === "fork"
          ? session.forkAggregate
            ? mapUsage(session.forkAggregate.inFile, approximate)
            : null
          : undefined;
      const files = [
        ...new Set(
          session.filesTouched.flatMap((file) => {
            const path = touchedPath(session, file.path);
            return path ? [safeText(path.relative, 120)] : [];
          }),
        ),
      ]
        .sort()
        .slice(0, 5);
      return {
        id: safeId(session.id),
        jitter: hashId(session.id),
        lane: lanes[index].id,
        title: redactTitles ? short(session.id) : safeText(session.title, 80),
        ...(!redactTitles ? { gist: summary(session) } : {}),
        startedAt: date(session.startedAt),
        endedAt: date(session.endedAt),
        status: session.state,
        ...(parent ? { subagentOf: safeId(parent.sessionId) } : {}),
        usage: mapUsage(session.usage, approximate),
        ...(contribution !== undefined ? { contribution } : {}),
        ...(session.usage.baseline && session.usage.threadCumulative
          ? { threadCumulative: session.usage.threadCumulative.total }
          : {}),
        fileCount: session.filesTouched.length,
        files,
      };
    }),
  );
  const ids = new Set(sessions.map(({ id }) => id));
  const edges = graph.lanes.flatMap((lane) =>
    lane.relationships.flatMap((edge) => {
      const from = safeId(edge.from);
      const to = safeId(edge.to);
      if (!ids.has(from) || !ids.has(to)) return [];
      const evidence =
        edge.evidence.source === "FileChange"
          ? edge.evidence.files.map((file) => safeText(file, 120))
          : edge.evidence.field
            ? [edge.evidence.field]
            : [];
      return [{ from, to, kind: edge.kind, evidence }];
    }),
  );
  const name = graph.key.split(/[\\/]/).filter(Boolean).at(-1) ?? "";
  return {
    label: safeText(name, 64) || short(graph.key),
    lanes,
    sessions,
    edges,
  };
}

export function mapData(
  graphs: readonly Graph[],
  redactTitles = false,
): MapData {
  const projects = graphs.map((graph) => projectData(graph, redactTitles));
  const counts = new Map<string, number>();
  for (const { label } of projects)
    counts.set(label, (counts.get(label) ?? 0) + 1);
  projects.forEach((project, index) => {
    if (counts.get(project.label)! > 1)
      project.label += " · " + safeId(graphs[index].key).slice(0, 6);
  });
  return { projects };
}

export async function mapDataWithHandoffs(
  graphs: readonly Graph[],
  {
    now,
    redactTitles = false,
    readGit = readHandoffGit,
  }: {
    now: number;
    redactTitles?: boolean;
    readGit?: ReadHandoffGit;
  },
) {
  const data = mapData(graphs, redactTitles);
  if (redactTitles) return data;
  for (const [index, graph] of graphs.entries()) {
    const project = data.projects[index];
    const git = await readGit(graph.repoRoot).catch(() => ({
      unavailable: ["Git facts could not be read."],
    }));
    const allSessions = graph.lanes.flatMap((lane) => lane.sessions);
    for (const [position, lane] of graph.lanes.entries()) {
      const { markdown, generatedAt } = await buildHandoff({
        title: lane.name,
        sessions: lane.sessions,
        allSessions,
        now,
        repoRoot: graph.repoRoot,
        readGit: async () => git,
      });
      project.lanes[position].handoff = { markdown, generatedAt };
    }
  }
  return data;
}

export async function demoMapWithHandoffs(data: MapData) {
  for (const project of data.projects) {
    const now = Date.parse(project.sessions[0].startedAt);
    for (const lane of project.lanes) {
      const { markdown, generatedAt } = await buildHandoff({
        title: lane.name,
        sessions: [],
        repoRoot: "synthetic-workspace",
        now,
        readGit: async () => ({
          branch: "synthetic-branch",
          head: "a".repeat(40),
          status: [],
          diffStat: [],
        }),
      });
      lane.handoff = { markdown, generatedAt };
    }
  }
  return data;
}
