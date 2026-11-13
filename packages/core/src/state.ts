import { compareTime, orderSessions } from "./lanes.js";
import type { CommandRun, Session } from "./types.js";

const minute = 60_000;
const week = 7 * 24 * 60 * minute;

function check(run: CommandRun) {
  return run.kind === "test" || run.kind === "build";
}

function commandKey(run: CommandRun) {
  return JSON.stringify([run.kind, run.command.trim()]);
}

export function states(input: readonly Session[], now: number): Session[] {
  const sessions = [...input].sort(orderSessions);
  const newest = Math.max(
    ...sessions
      .map((session) => Date.parse(session.endedAt))
      .filter(Number.isFinite),
  );
  const successes = new Map<string, string>();
  const result: Session[] = [];
  for (const session of sessions.reverse()) {
    const checks = session.commands.filter(check);
    // Evidence records are ordered by appearance, including those without timestamps.
    const last = checks.at(-1);
    const succeededAt = last && successes.get(commandKey(last));
    const recovered =
      succeededAt !== undefined &&
      (!last?.startedAt ||
        !succeededAt ||
        compareTime(succeededAt, last.startedAt) > 0);
    const stale = Number.isFinite(newest) && now - newest > week;
    const elapsed = now - Date.parse(session.endedAt);
    let state: Session["state"] = "done";
    let reason = "没有待完成工具调用或未恢复的测试、构建失败";
    if (
      session.pendingLastToolCall ||
      (elapsed >= 0 && elapsed <= 30 * minute)
    ) {
      state = "open";
      reason = session.pendingLastToolCall
        ? "最后一条记录显示工具调用待完成"
        : "会话在扫描前 30 分钟内结束";
    } else if (
      last?.exitCode !== undefined &&
      last.exitCode !== 0 &&
      !recovered
    ) {
      state = "warn";
      reason = `最后一条${last.kind === "test" ? "测试" : "构建"}退出码为 ${last.exitCode}，主线后续会话没有成功重跑同一命令`;
    } else if (
      last?.exitCode !== undefined &&
      last.exitCode !== 0 &&
      recovered
    ) {
      reason = "主线后续会话已成功重跑此前失败的命令";
    }

    const stateReasons = [reason];
    if (stale && (state === "open" || state === "warn")) {
      state = "idle";
      stateReasons.push("主线最近一次会话已超过 7 天");
    }
    result.push({
      ...session,
      state,
      stateReasons,
      stateProvenance: "inferred",
    });
    for (const run of checks) {
      if (run.exitCode !== 0) continue;
      const key = commandKey(run);
      const when = run.startedAt ?? session.startedAt;
      const previous = successes.get(key);
      if (previous === undefined || compareTime(when, previous) > 0)
        successes.set(key, when);
    }
  }
  return result.reverse();
}
