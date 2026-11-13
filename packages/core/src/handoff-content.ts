import { redact } from "./redact.js";
import { touchedPath } from "./repositories.js";
import type { Session } from "./types.js";

export type HandoffProvenance = "verified" | "inferred" | "excerpt";

export interface HandoffItem {
  text: string;
  source?: string;
}

export type HandoffSectionId =
  | "verify"
  | "goal"
  | "current"
  | "tests"
  | "done"
  | "constraints"
  | "approvals"
  | "gaps"
  | "open"
  | "pointers";

export interface HandoffSection {
  id: HandoffSectionId;
  provenance: HandoffProvenance;
  items: HandoffItem[];
}

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
export const shorten = (value: string, length: number) =>
  Array.from(redact(value)).slice(0, length).join("");
const singleLine = (value: string) => value.replace(/\s+/gu, " ").trim();
const chronological = (a: Session, b: Session) =>
  compare(a.startedAt || "~", b.startedAt || "~") || compare(a.id, b.id);
const constraints =
  /\b(?:don't|do not|never|must|only)\b|不要|不能|禁止|必须|只能/iu;
const pending =
  /(?:待|等|需要|请).{0,12}(?:确认|批准|授权)|\b(?:pending approval|awaiting confirmation|please confirm|needs approval)\b/iu;
const approved =
  /^(?:确认|同意|批准|允许|授权|可以(?:执行|继续|提交|推送)|yes\b|approved\b|i approve\b|go ahead\b)/iu;
const todo = /\b(?:TODO|FIXME)\b/u;

function sentences(text: string) {
  return text
    .split(/\r?\n|(?<=[。！？!?])\s*/u)
    .map(singleLine)
    .filter(Boolean);
}

interface InferredItem extends HandoffItem {
  at: number;
  sessionId: string;
}

function inferredItem(
  text: string,
  session?: Session,
  at?: string,
  source?: string,
): InferredItem {
  const time = [at, session?.endedAt, session?.startedAt].find(
    (value) => value && Number.isFinite(Date.parse(value)),
  );
  return {
    text,
    ...(source ? { source } : {}),
    at: time ? Date.parse(time) : 0,
    sessionId: session?.id ?? "",
  };
}

function recentDistinct(items: InferredItem[]): HandoffItem[] {
  const seen = new Set<string>();
  return items
    .sort((a, b) => b.at - a.at || compare(a.sessionId, b.sessionId))
    .filter(({ text }) => {
      if (seen.has(text)) return false;
      seen.add(text);
      return true;
    })
    .slice(0, 5)
    .map(({ text, source }) => ({ text, ...(source ? { source } : {}) }));
}

export function handoffOwners(sessions: readonly Session[]) {
  const byId = new Map(sessions.map((session) => [session.id, session]));
  const owners = new Map<string, Session | undefined>();
  for (const session of sessions) {
    let current: Session | undefined = session;
    let owner: Session | undefined;
    const seen = new Set<string>();
    while (current && !seen.has(current.id)) {
      if (owners.has(current.id)) {
        owner = owners.get(current.id);
        break;
      }
      seen.add(current.id);
      const parent: string | undefined = current.parents.find(
        (link) => link.kind === "subagent" && link.provenance === "verified",
      )?.sessionId;
      if (!parent) {
        owner = current;
        break;
      }
      current = byId.get(parent);
    }
    for (const id of seen) owners.set(id, owner);
  }
  return owners;
}

export function handoffContent(
  members: readonly Session[],
  universe: readonly Session[] = members,
  assistantExcerptLimit = 200,
) {
  const sessions = [...members].sort(chronological);
  const rows: HandoffSection[] = [];
  const add = (
    id: HandoffSectionId,
    provenance: HandoffProvenance,
    items: HandoffItem[],
  ) => {
    if (items.length) rows.push({ id, provenance, items });
  };
  const scope = new Set(sessions.map(({ id }) => id));
  const owners = handoffOwners(universe);
  const counts = new Map<string, number>();
  let orphaned = 0;
  for (const session of universe) {
    const owner = owners.get(session.id);
    if (owner && owner.id !== session.id && scope.has(owner.id))
      counts.set(owner.id, (counts.get(owner.id) ?? 0) + 1);
    if (!owner && scope.has(session.id)) orphaned++;
  }
  const main = sessions.filter(
    (session) =>
      !session.parents.some(
        (link) => link.kind === "subagent" && link.provenance === "verified",
      ),
  );
  const evidenceSessions = universe.filter((session) => {
    if (scope.has(session.id)) return true;
    const owner = owners.get(session.id);
    return owner !== undefined && scope.has(owner.id);
  });
  const runs = evidenceSessions
    .flatMap((session) =>
      session.commands.flatMap((run, index) =>
        run.structured && (run.kind === "build" || run.kind === "test")
          ? [{ session, run, index, time: run.startedAt || session.endedAt }]
          : [],
      ),
    )
    .sort(
      (a, b) =>
        compare(a.time, b.time) ||
        compare(a.session.id, b.session.id) ||
        a.index - b.index,
    );
  const latest = runs.at(-1);
  const commandItem = latest && {
    text: [
      latest.run.command,
      ...(latest.run.structured?.exitCode === undefined
        ? []
        : ["Exit code: " + latest.run.structured.exitCode]),
      ...(latest.run.structured?.outputTail
        ? ["Output tail:", latest.run.structured.outputTail]
        : []),
    ].join("\n"),
    source: latest.session.agent + " session " + latest.session.id,
  };
  if (commandItem) add("tests", "verified", [commandItem]);
  const goalSession = main[0];
  const goal = goalSession?.userMessages[0]?.text;
  const goalText = singleLine(goal ?? "");
  if (goal)
    add("goal", "excerpt", [
      {
        text: goal,
        source: main[0].id,
      },
    ]);

  add(
    "done",
    "excerpt",
    main.map((session) => {
      const count = counts.get(session.id) ?? 0;
      const title = singleLine(session.title) || session.id;
      return {
        text: [
          title + (count ? ` (+${count} subagents)` : ""),
          ...(session.finalAssistantText
            ? [shorten(session.finalAssistantText, assistantExcerptLimit)]
            : []),
        ].join("\n"),
        source: session.id,
      };
    }),
  );

  const constraintItems: InferredItem[] = [];
  const approvalItems: InferredItem[] = [];
  const openItems: InferredItem[] = [];
  const gaps: InferredItem[] = [];
  for (const session of main) {
    for (const [index, message] of session.userMessages.entries()) {
      const isGoalMessage = session.id === goalSession?.id && index === 0;
      const source = [session.id, message.at].filter(Boolean).join(" · ");
      for (const sentence of sentences(message.text)) {
        const text = shorten(sentence, 300);
        const item = (value: string) =>
          inferredItem(value, session, message.at, source);
        const overlapsGoal =
          goalText &&
          (goalText.includes(sentence) || sentence.includes(goalText));
        if (!isGoalMessage && !overlapsGoal && constraints.test(sentence))
          constraintItems.push(item(text));
        if (pending.test(sentence))
          approvalItems.push(item("Pending in history: " + text));
        else if (approved.test(sentence))
          approvalItems.push(
            item(
              "Approval wording in history (scope requires verification): " +
                text,
            ),
          );
        if (todo.test(sentence)) openItems.push(item(text));
      }
    }
    const assistantItems =
      session.assistantOpenItems ??
      sentences(session.finalAssistantText ?? "")
        .filter((text) => todo.test(text) || /[?？]$/u.test(text))
        .map((text) => ({ text, at: "" }));
    for (const { text, at } of assistantItems)
      openItems.push(
        inferredItem(
          shorten(text, 300),
          session,
          at,
          [session.id, at].filter(Boolean).join(" · "),
        ),
      );
  }
  const latestByCommand = new Map<string, (typeof runs)[number]>();
  for (const entry of runs)
    latestByCommand.set(entry.run.kind + "\0" + entry.run.command, entry);
  for (const { run, session, time } of latestByCommand.values()) {
    const exit = run.structured?.exitCode;
    if (run.kind === "test" && exit !== undefined && exit !== 0)
      openItems.push(
        inferredItem(
          `Last recorded run failed (exit ${exit}): ${shorten(run.command, 300)}`,
          session,
          time,
          session.id,
        ),
      );
  }
  if (!latest)
    gaps.push(inferredItem("No structured test or build record was found."));
  else if (latest.run.structured?.exitCode === undefined)
    gaps.push(
      inferredItem(
        "The latest recorded test or build has no structured exit code.",
        latest.session,
        latest.time,
        latest.session.id,
      ),
    );
  if (orphaned)
    gaps.push(
      inferredItem(
        `${orphaned} subagent session(s) could not be attributed to an available parent.`,
      ),
    );
  const newest = (items: readonly Session[]) =>
    [...items].sort(
      (a, b) =>
        compare(b.endedAt || b.startedAt, a.endedAt || a.startedAt) ||
        compare(a.id, b.id),
    )[0];
  const missingFiles = newest(
    main.filter(
      (session) => session.finalAssistantText && !session.filesTouched.length,
    ),
  );
  if (missingFiles)
    gaps.push(
      inferredItem(
        "One or more assistant excerpts have no structured file-change evidence.",
        missingFiles,
      ),
    );
  const incomplete = newest(
    sessions.filter(
      ({ parse }) =>
        !parse.ok ||
        parse.badLines ||
        parse.truncatedLines ||
        parse.partialLines,
    ),
  );
  if (incomplete)
    gaps.push(
      inferredItem(
        "Some session records were incomplete or could not be parsed.",
        incomplete,
      ),
    );

  add("open", "inferred", recentDistinct(openItems));
  add("constraints", "inferred", recentDistinct(constraintItems));
  add("approvals", "inferred", recentDistinct(approvalItems));
  add("gaps", "inferred", recentDistinct(gaps));

  const paths = [
    ...new Set(
      evidenceSessions.flatMap((session) =>
        session.filesTouched.flatMap(({ path }) => {
          const relative = touchedPath(session, path)?.relative;
          return relative ? [relative] : [];
        }),
      ),
    ),
  ].sort(compare);
  add("pointers", "verified", [
    ...paths.slice(0, 12).map((text) => ({ text })),
    ...main
      .slice(-8)
      .map((session) => ({ text: session.agent + " session " + session.id })),
  ]);
  return rows;
}
