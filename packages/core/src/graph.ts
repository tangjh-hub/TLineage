import { byId, clusterLanes } from "./lanes.js";
import { readOverrides } from "./overrides.js";
import { relationships } from "./relationships.js";
import { locateRepository, repositoryKey } from "./repositories.js";
import { states } from "./state.js";
import type { Session, Usage } from "./types.js";
import { totalUsage } from "./usage.js";

export function usageJson(usage: Usage) {
  const {
    scope,
    quality,
    provenance,
    note,
    baseline,
    threadCumulative,
    ...inFile
  } = usage;
  return {
    scope,
    quality,
    provenance,
    ...(note ? { note } : {}),
    inFile,
    baseline: baseline ?? null,
    threadCumulative: threadCumulative ?? null,
  };
}

export async function buildGraphs(
  input: readonly Session[],
  options: { cwd?: string; now?: number } = {},
) {
  const now = options.now ?? Date.now();
  const repos = new Map<string, ReturnType<typeof locateRepository>>();
  const locate = (cwd: string) => {
    let lookup = repos.get(cwd);
    if (!lookup) {
      lookup = locateRepository(cwd);
      repos.set(cwd, lookup);
    }
    return lookup;
  };
  const scope =
    options.cwd === undefined
      ? undefined
      : ((await locate(options.cwd))?.repoRoot ?? options.cwd);
  const groups = new Map<string, { repoRoot?: string; sessions: Session[] }>();
  for (const session of input) {
    const repository = await locate(session.cwd);
    const normalized = { ...session, ...repository };
    const key = repositoryKey(normalized);
    if (scope !== undefined && key !== scope) continue;
    const group = groups.get(key) ?? {
      repoRoot: normalized.repoRoot,
      sessions: [],
    };
    groups.set(key, group);
    group.sessions.push(normalized);
  }
  return Promise.all(
    [...groups]
      .sort(([a], [b]) => byId(a, b))
      .map(async ([key, group]) => {
        const overrides = group.repoRoot
          ? await readOverrides(group.repoRoot)
          : undefined;
        const edges = relationships(group.sessions);
        const lanes = clusterLanes(group.sessions, overrides).map((lane) => {
          const members = states(lane.sessions, now);
          const ids = new Set(members.map((session) => session.id));
          return {
            ...lane,
            sessions: members,
            usage: totalUsage(members),
            relationships: edges.filter((edge) => ids.has(edge.to)),
          };
        });
        return { key, repoRoot: group.repoRoot ?? null, lanes };
      }),
  );
}

export function lanesJson(graphs: Awaited<ReturnType<typeof buildGraphs>>) {
  return graphs.map(({ key, repoRoot, lanes }) => ({
    cwd: key,
    repoRoot,
    lanes: lanes.map(
      ({ id, name, nameSource, sessions, usage, relationships }) => ({
        id,
        name,
        nameSource,
        usage: usageJson(usage),
        relationships,
        sessions: sessions.map((session) => ({
          id: session.id,
          cwd: session.cwd,
          worktreePath: session.worktreePath ?? null,
          gitBranch: session.gitBranch ?? null,
          startedAt: session.startedAt,
          endedAt: session.endedAt,
          title: session.title,
          titleProvenance: session.titleProvenance,
          usage: usageJson(session.usage),
          state: session.state,
          stateReasons: session.stateReasons,
          stateProvenance: session.stateProvenance,
        })),
      }),
    ),
  }));
}
