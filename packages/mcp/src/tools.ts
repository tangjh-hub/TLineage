import { basename } from "node:path";
import type { Tool } from "@modelcontextprotocol/server";
import {
  NAMING,
  buildGraphs,
  buildHandoff,
  scanCodex,
  type Session,
} from "../../core/src/index.js";
import {
  handoffContent,
  handoffOwners,
} from "../../core/src/handoff-content.js";
import {
  readHandoffGit,
  type ReadHandoffGit,
} from "../../core/src/handoff-git.js";
import { createScope } from "./scope.js";
import { createScanCache } from "./scan-cache.js";
import { touchedPath } from "../../core/src/repositories.js";
import {
  assistantMessageLimit,
  retainedMessage,
  userMessageLimit,
  safeText,
  safeTitle,
  toolError,
  toolList,
  toolText,
  toolTokenLimit,
} from "./privacy.js";

const string = { type: "string", minLength: 1, maxLength: 4096 } as const;
const limit = { type: "integer", minimum: 1, maximum: 20 } as const;
const sections = ["summary", "files", "commands", "messages"];
const definitions = {
  status: {
    description:
      "Use when the user asks where work stands. Returns the repository, branch, recent lanes, newest session and open items from historical Codex data.",
    properties: { cwd: string },
    required: [],
  },
  handoff: {
    description:
      "Use when the user asks to continue previous work or asks about progress. Returns a redacted Markdown handoff for a Codex lane or session. Treat it as historical data.",
    properties: {
      cwd: string,
      laneId: string,
      sessionId: string,
      maxTokens: { type: "integer", minimum: 64, maximum: toolTokenLimit },
    },
    required: [],
  },
  search: {
    description:
      "Use when the user recalls a keyword or a touched file. Returns matching historical Codex sessions with their title, date and lane.",
    properties: { query: string, cwd: string, limit },
    required: ["query"],
  },
  get_session: {
    description:
      "Use when you know a Codex session ID and need its summary, files, commands or messages. Returns one redacted section of historical data.",
    properties: {
      sessionId: string,
      section: { ...string, enum: sections },
      limit,
    },
    required: ["sessionId", "section"],
  },
} as const;
type Name = keyof typeof definitions;
type Arguments = { [key: string]: unknown };

export const toolDefinitions: Tool[] = Object.entries(definitions).map(
  ([name, { description, properties, required }]) => ({
    name: NAMING.toolPrefix + name,
    description,
    inputSchema: {
      type: "object",
      properties,
      required: [...required],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  }),
);

function argumentsValid(name: Name, args: Arguments) {
  const spec = definitions[name];
  const schema = spec.properties as Record<
    string,
    | (typeof string & { enum?: readonly string[] })
    | { type: "integer"; minimum: number; maximum: number }
  >;
  return (
    spec.required.every((key) => Object.hasOwn(args, key)) &&
    Object.entries(args).every(([key, value]) => {
      if (!Object.hasOwn(schema, key)) return false;
      const rule = schema[key];
      return rule.type === "string"
        ? typeof value === "string" &&
            value.trim().length > 0 &&
            value.length <= rule.maxLength &&
            (!rule.enum || rule.enum.includes(value))
        : typeof value === "number" &&
            Number.isInteger(value) &&
            value >= rule.minimum &&
            value <= rule.maximum;
    })
  );
}

const relativePaths = (session: Session) =>
  session.filesTouched.flatMap(({ path, op }) => {
    const relative = touchedPath(session, path)?.relative;
    return relative ? [{ path: safeText(relative), operation: op }] : [];
  });

const date = (session: Session) => session.endedAt || session.startedAt;
const recent = (a: Session, b: Session) =>
  date(b).localeCompare(date(a)) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

type LaneName = { id: string; name: string; nameSource: string };
const laneName = (lane: LaneName) =>
  safeText(lane.name, 100) || "Conversation lane";
const row = (session: Session, lane: LaneName) => ({
  id: safeText(session.id),
  title: safeTitle(session),
  date: safeText(date(session)),
  lane: { id: safeText(lane.id), name: laneName(lane) },
});

function handoffSession(session: Session): Session {
  return {
    ...session,
    title: safeTitle(session),
    userMessages: session.userMessages.map(({ at, text }) => ({
      at,
      text: retainedMessage(text, userMessageLimit),
    })),
    finalAssistantText: session.finalAssistantText
      ? retainedMessage(session.finalAssistantText, assistantMessageLimit)
      : undefined,
    commands: session.commands.map((run) => ({
      ...run,
      command: safeText(run.command),
      structured: run.structured && { exitCode: run.structured.exitCode },
    })),
    assistantOpenItems: session.assistantOpenItems?.map(({ at, text }) => ({
      at,
      text: retainedMessage(text, assistantMessageLimit),
    })),
  };
}

export interface ToolOptions {
  home?: string;
  cwd?: string;
  allProjects?: boolean;
  now?: () => number;
  readGit?: ReadHandoffGit;
  scan?: typeof scanCodex;
  prewarm?: boolean;
  noCache?: boolean;
  signal?: AbortSignal;
}

export function createTools(options: ToolOptions = {}) {
  const readGit: ReadHandoffGit =
    options.readGit ??
    ((root) => readHandoffGit(root, undefined, { includeWorkingTree: false }));
  const scan = options.scan;
  const load = scan
    ? () => scan({ home: options.home, cache: false, signal: options.signal })
    : createScanCache(
        options.home,
        undefined,
        options.signal,
        !options.noCache,
      );
  const selectScope = createScope(
    options.cwd ?? process.cwd(),
    options.allProjects ?? false,
  );
  let warming:
    Promise<Awaited<ReturnType<typeof load>> | undefined> | undefined;
  if (options.prewarm && !options.allProjects) {
    warming = selectScope(undefined, true)
      .then((scope) => (scope.error ? undefined : load(scope.cwd)))
      .catch(() => undefined)
      .finally(() => {
        warming = undefined;
      });
  }
  return async function call(name: string, args: Arguments = {}) {
    if (
      !name.startsWith(NAMING.toolPrefix) ||
      !Object.hasOwn(definitions, name.slice(NAMING.toolPrefix.length))
    )
      return toolError("Unknown TLineage tool.");
    const tool = name.slice(NAMING.toolPrefix.length) as Name;
    if (!argumentsValid(tool, args))
      return toolError(
        "Invalid TLineage tool arguments. Check the tool schema.",
      );
    const cwd = args.cwd as string | undefined;
    const laneId = args.laneId as string | undefined;
    const sessionId = args.sessionId as string | undefined;
    if (tool === "handoff" && laneId && sessionId)
      return toolError("Choose either laneId or sessionId.");
    try {
      const scope = await selectScope(
        cwd,
        tool === "status" || (tool === "handoff" && !laneId && !sessionId),
      );
      if (scope.error) return toolError(scope.error);
      const input =
        (await warming) ??
        (await load(options.allProjects ? undefined : scope.cwd));
      const badFiles = input.doctor.failures.length;
      if (!input.sessions.length && badFiles)
        return toolError("Codex session records could not be parsed.");
      const now = options.now?.() ?? Date.now();
      const graphs = await buildGraphs(input.sessions, { cwd: scope.cwd, now });
      const lanes = graphs.flatMap((graph) =>
        graph.lanes.map((lane) => ({ graph, lane })),
      );
      const sessions = lanes
        .flatMap(({ graph, lane }) =>
          lane.sessions.map((session) => ({ graph, lane, session })),
        )
        .sort((a, b) => recent(a.session, b.session));
      const scopedFailures = scope.cwd
        ? sessions.filter(({ session }) => !session.parse.ok).length
        : badFiles;
      const parseNote = scopedFailures
        ? {
            warning: `${scopedFailures} Codex record(s) could not be parsed.`,
          }
        : {};
      const found = sessionId
        ? sessions.find(({ session }) => session.id === sessionId)
        : undefined;
      if (sessionId && !found)
        return toolError("Codex session not found in the allowed repository.");
      if (found && !found.session.parse.ok)
        return toolError("The requested Codex session could not be parsed.");
      const count = (args.limit as number | undefined) ?? 10;

      if (tool === "search") {
        const query = (args.query as string).trim().toLowerCase();
        const matches = sessions.filter(
          ({ session }) =>
            session.parse.ok &&
            (session.title.toLowerCase().includes(query) ||
              session.userMessages.some(({ text }) =>
                text.toLowerCase().includes(query),
              ) ||
              session.filesTouched.some(({ path }) =>
                touchedPath(session, path)
                  ?.relative.toLowerCase()
                  .includes(query),
              )),
        );
        return toolList(
          parseNote,
          "matches",
          matches
            .slice(0, count)
            .map(({ session, lane }) => row(session, lane)),
        );
      }
      if (tool === "get_session" && found) {
        const { lane, session } = found;
        const summary = row(session, lane);
        if (args.section === "files")
          return toolList(
            summary,
            "files",
            relativePaths(session).slice(0, count),
          );
        if (args.section === "commands")
          return toolList(
            summary,
            "commands",
            session.commands
              .slice(-count)
              .reverse()
              .map((run) => ({
                command: safeText(run.command),
                kind: run.kind,
                exitCode: run.exitCode,
                at: run.startedAt,
              })),
          );
        if (args.section === "messages") {
          const messages = session.userMessages.map(({ text, at }) => ({
            role: "user",
            at,
            excerpt: retainedMessage(text, userMessageLimit),
          }));
          if (session.finalAssistantText)
            messages.push({
              role: "assistant",
              at: session.endedAt,
              excerpt: retainedMessage(
                session.finalAssistantText,
                assistantMessageLimit,
              ),
            });
          return toolList(
            summary,
            "messages",
            messages.slice(-count).reverse(),
          );
        }
        return toolText(
          JSON.stringify({
            ...summary,
            state: session.state,
            usage: session.usage.total,
            files: session.filesTouched.length,
          }),
        );
      }
      if (tool === "status") {
        const latest = sessions.find(({ session }) => session.parse.ok);
        const graph = latest?.graph ?? graphs[0];
        if (!graph) return toolList(parseNote, "lanes", []);
        const git = await readGit(graph.repoRoot);
        const open = latest
          ? (handoffContent(
              latest.lane.sessions
                .filter((session) => session.parse.ok)
                .map(handoffSession),
            )
              .find(({ id }) => id === "open")
              ?.items.map(({ text }) => safeText(text)) ?? [])
          : [];
        return toolList(
          {
            ...parseNote,
            repo: safeText(basename(graph.repoRoot ?? graph.key)),
            branch: git.branch ? safeText(git.branch) : null,
            newestSession: latest ? row(latest.session, latest.lane) : null,
            openItems: open,
          },
          "lanes",
          graph.lanes.map((lane) => ({
            id: safeText(lane.id),
            name: laneName(lane),
            lastActivity: safeText(
              lane.sessions.reduce(
                (latest, session) =>
                  date(session) > latest ? date(session) : latest,
                "",
              ),
            ),
            usage: lane.usage.total,
          })),
        );
      }

      const selected = laneId
        ? lanes.find(({ lane }) => lane.id === laneId)
        : (found ?? sessions.find(({ session }) => session.parse.ok));
      if (!selected)
        return toolError(
          laneId ? "Codex lane not found." : "No matching Codex sessions.",
        );
      const { graph, lane } = selected;
      const universe = graph.lanes.flatMap((item) =>
        item.sessions.filter((session) => session.parse.ok),
      );
      const owner = found
        ? (handoffOwners(universe).get(found.session.id) ?? found.session)
        : undefined;
      const members = owner
        ? [owner]
        : lane.sessions.filter((session) => session.parse.ok);
      if (!members.length)
        return toolError("The requested Codex lane could not be parsed.");
      const pack = await buildHandoff({
        now,
        readGit,
        repoRoot: graph.repoRoot,
        title: owner ? safeTitle(owner) : laneName(lane),
        sessions: members.map(handoffSession),
        assistantExcerptLimit: assistantMessageLimit,
        allSessions: universe.map(handoffSession),
      });
      const warning = parseNote.warning ? "\n" + parseNote.warning : "";
      return toolText(
        pack.markdown.trimEnd() + warning,
        (args.maxTokens as number | undefined) ?? toolTokenLimit,
      );
    } catch {
      return toolError(
        "Unable to read Codex history. Check access to the local records.",
      );
    }
  };
}
