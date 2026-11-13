import {
  object,
  string,
  type JsonObject,
  type Session,
  type Usage,
  type UsageCounts,
  type UsageSource,
} from "./types.js";

const fields = {
  input: "input_tokens",
  output: "output_tokens",
  cacheRead: "cached_input_tokens",
  cacheWrite: "cache_write_input_tokens",
  reasoning: "reasoning_output_tokens",
  total: "total_tokens",
} as const;
type Totals = UsageCounts;
type Source = "legacy" | "record";
const sourceName = (source: Source): UsageSource =>
  source === "legacy" ? "token_count" : "token_usage_record";
const keys = Object.keys(fields) as (keyof Totals)[];
const empty = (): Totals => ({
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  reasoning: 0,
  total: 0,
});
const signature = (usage: Totals) => keys.map((key) => usage[key]).join(",");
const tokenLimitPerTurn = 4096;

function add(target: Totals, source: Totals) {
  for (const key of keys) target[key] += source[key];
}

function counters(value: unknown): Totals | undefined {
  const record = object(value);
  const result = empty();
  if (record.total_tokens === undefined) return;
  for (const key of keys) {
    const count = record[fields[key]] ?? 0;
    if (typeof count !== "number" || !Number.isSafeInteger(count) || count < 0)
      return;
    result[key] = count;
  }
  return result;
}

function pairSignature(last?: Totals, snapshot?: Totals): string {
  return last && snapshot ? signature(last) + "|" + signature(snapshot) : "";
}

export function tokenRecordSignature(
  type: unknown,
  payload: JsonObject,
): string | null {
  let last;
  let snapshot;
  if (type === "token_usage_record") {
    last = payload.usage;
    snapshot = payload.thread_token_usage;
  } else if (type === "event_msg" && payload.type === "token_count") {
    const info = object(payload.info);
    last = info.last_token_usage;
    snapshot = info.total_token_usage;
  }
  if (last == null && snapshot == null) return "";
  const increment = counters(last);
  const cumulative = counters(snapshot);
  if (!increment || !cumulative || increment.total > cumulative.total)
    return null;
  return increment.total > 0 ? pairSignature(increment, cumulative) : "";
}

class ForkDeductions {
  private readonly counts = empty();
  private readonly seen = new Set<string>();
  private duplicate = false;

  constructor(private readonly prefix?: ReadonlySet<string>) {}

  include(delta: Delta) {
    if (!this.prefix?.has(delta.key)) return;
    if (this.seen.has(delta.key)) this.duplicate = true;
    else {
      this.seen.add(delta.key);
      add(this.counts, delta.last);
    }
  }

  reconcile(sum: Totals): Session["forkAggregate"] {
    if (!this.prefix || this.duplicate) return;
    const inFile = empty();
    for (const key of keys) {
      inFile[key] = sum[key] - this.counts[key];
      if (inFile[key] < 0 || !Number.isSafeInteger(inFile[key])) return;
    }
    return { inFile, excludedSignatures: this.seen.size };
  }
}

interface Delta {
  order: number;
  source: Source;
  last: Totals;
  snapshot?: Totals;
  key: string;
}
interface Interval {
  start: number;
  end: number;
}

function interval(delta: Delta): Interval | undefined {
  const end = delta.snapshot?.total;
  if (end === undefined || delta.last.total > end) return;
  return { start: end - delta.last.total, end };
}

function overlap(intervals: readonly Interval[], target: Interval): boolean {
  // Disjoint sorted ranges allow finding the first one ending after target.start.
  let low = 0;
  let high = intervals.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (intervals[middle].end <= target.start) low = middle + 1;
    else high = middle;
  }
  return (
    target.start < target.end &&
    low < intervals.length &&
    intervals[low].start < target.end
  );
}

export class UsageAccumulator {
  private readonly sum = empty();
  private readonly modernSum = empty();
  private readonly notes = new Set<string>();
  private readonly old = new Map<string, Delta>();
  private readonly modern = new Map<string, Delta>();
  private readonly previous: Partial<Record<Source, Totals>> = {};
  private turn = "";
  private rollbackInTurn = false;
  private legacyOnlyTurn = false;
  private finalSnapshot?: Totals;
  private threadCumulative?: Usage["threadCumulative"];
  private firstObserved?: { order: number; key: string };
  private firstIncluded?: Delta;
  private hadRollback = false;
  private observations = 0;
  private serial = 0;
  private readonly combinedDeductions: ForkDeductions;
  private readonly modernDeductions: ForkDeductions;
  forkAggregate?: Session["forkAggregate"];

  constructor(forkPrefix?: ReadonlySet<string>) {
    this.combinedDeductions = new ForkDeductions(forkPrefix);
    this.modernDeductions = new ForkDeductions(forkPrefix);
  }

  startTurn(turn: string) {
    if (!turn || turn === this.turn) return;
    if (this.turn) this.flushTurn();
    this.turn = turn;
  }

  legacy(info: JsonObject) {
    const last = counters(info.last_token_usage);
    const snapshot = counters(info.total_token_usage);
    if (last || snapshot) this.observe("legacy", last, snapshot);
  }

  record(payload: JsonObject) {
    this.startTurn(string(payload.turn_id));
    this.observe(
      "record",
      counters(payload.usage),
      counters(payload.thread_token_usage),
      string(payload.response_id),
    );
  }

  private observe(
    source: Source,
    last?: Totals,
    snapshot?: Totals,
    responseId = "",
  ) {
    if (!last && !snapshot) return;
    if (this.old.size + this.modern.size >= tokenLimitPerTurn) {
      this.notes.add("用量去重窗口达到上限");
      this.flushTurn();
    }
    const key = pairSignature(last, snapshot);
    const order = ++this.serial;
    this.firstObserved ??= { order, key };
    if (snapshot) {
      this.threadCumulative = {
        ...snapshot,
        source: sourceName(source),
        provenance: "verified",
      };
    }
    const target = source === "record" ? this.modern : this.old;
    const identity = responseId
      ? "id:" + responseId.slice(0, 256)
      : key || "sequence:" + order;
    const existing = target.get(identity);
    if (existing) {
      if (key && existing.key && key !== existing.key) {
        this.notes.add("相同响应 ID 的用量记录冲突");
      }
      return;
    }

    if (snapshot) {
      const previous = this.previous[source];
      if (previous && snapshot.total < previous.total) {
        this.notes.add("累计用量快照回落");
        this.rollbackInTurn = true;
        this.hadRollback = true;
      }
      this.previous[source] = snapshot;
      this.finalSnapshot = snapshot;
    }
    if (!last) {
      this.notes.add("部分用量记录缺少单次增量");
      return;
    }
    if (!key) this.notes.add("部分用量记录缺少配对所需的快照");
    target.set(identity, { order, source, last, snapshot, key });
  }

  private include(delta: Delta) {
    if (!this.firstIncluded || delta.order < this.firstIncluded.order) {
      this.firstIncluded = delta;
    }
    this.observations++;
    add(this.sum, delta.last);
    this.combinedDeductions.include(delta);
  }

  private flushTurn() {
    const modern = [...this.modern.values()];
    if (!modern.length && this.old.size) this.legacyOnlyTurn = true;
    const keys = new Set(modern.map((delta) => delta.key).filter(Boolean));
    const ranges = modern
      .map(interval)
      .filter((entry): entry is Interval => Boolean(entry));
    const comparable = !this.rollbackInTurn && ranges.length === modern.length;
    const merged: Interval[] = [];
    for (const range of ranges.sort((a, b) => a.start - b.start)) {
      if (range.start === range.end) continue;
      const last = merged.at(-1);
      if (last && range.start <= last.end)
        last.end = Math.max(last.end, range.end);
      else merged.push(range);
    }

    for (const delta of modern) {
      this.include(delta);
      add(this.modernSum, delta.last);
      this.modernDeductions.include(delta);
    }
    for (const delta of this.old.values()) {
      if (delta.key && keys.has(delta.key)) continue;
      const range = interval(delta);
      if (!modern.length || (comparable && range && !overlap(merged, range))) {
        this.include(delta);
      } else {
        this.notes.add("新旧来源的用量区间重叠或不可比较，保留新记录");
      }
    }
    this.old.clear();
    this.modern.clear();
    this.rollbackInTurn = false;
  }

  private confirmedBaseline(sum: Totals, end: Totals): Usage["baseline"] {
    const first = this.firstIncluded;
    const observed = this.firstObserved;
    if (
      !first?.snapshot ||
      !observed ||
      this.hadRollback ||
      (first.order !== observed.order && first.key !== observed.key)
    )
      return;

    const before = empty();
    for (const key of keys) {
      before[key] = first.snapshot[key] - first.last[key];
      if (before[key] < 0 || sum[key] + before[key] !== end[key]) return;
    }
    if (before.total > 0) {
      return {
        ...before,
        source: sourceName(first.source),
        provenance: "inferred",
      };
    }
  }

  finish(fork: boolean): Usage {
    this.flushTurn();
    const modern = this.previous.record;
    const legacy = this.previous.legacy;
    let sum = this.sum;
    let snapshot = this.finalSnapshot;
    if (
      modern &&
      legacy &&
      !this.legacyOnlyTurn &&
      legacy.total <= modern.total &&
      signature(this.modernSum) === signature(modern)
    ) {
      // When the newer deltas already reconcile with their snapshot across the
      // thread, legacy ranges can appear disjoint because their baselines differ.
      if (
        signature(legacy) !== signature(modern) ||
        signature(sum) !== signature(this.modernSum)
      ) {
        this.notes.add("新旧累计快照或增量口径不一致，采用已对齐的新式增量");
      }
      sum = this.modernSum;
      snapshot = modern;
    }
    const baseline = snapshot
      ? this.confirmedBaseline(sum, snapshot)
      : undefined;
    this.forkAggregate = fork
      ? (sum === this.modernSum
          ? this.modernDeductions
          : this.combinedDeductions
        ).reconcile(sum)
      : undefined;
    if (fork && !this.forkAggregate) this.notes.add("分叉的历史重叠证据不足");
    if (!this.observations) this.notes.add("缺少可计入的单次用量记录");
    if (!snapshot) this.notes.add("缺少累计用量快照");
    else if (!baseline && signature(sum) !== signature(snapshot)) {
      this.notes.add("去重后的用量之和与最终快照不一致");
    }
    return {
      ...sum,
      scope: "inFile",
      ...(baseline ? { baseline } : {}),
      ...(this.threadCumulative
        ? { threadCumulative: this.threadCumulative }
        : {}),
      quality: this.notes.size ? "approx" : "exact",
      provenance: "inferred",
      ...(this.notes.size ? { note: [...this.notes].join("。") } : {}),
    };
  }
}

export function totalUsage(sessions: readonly Session[]): Usage {
  const total = empty();
  let excluded = 0;
  let approximate = false;
  for (const session of sessions) {
    if (session.parent?.kind === "fork" && !session.forkAggregate) {
      excluded++;
      continue;
    }
    approximate ||= session.usage.quality === "approx";
    add(total, session.forkAggregate?.inFile ?? session.usage);
  }
  return {
    ...total,
    scope: "inFile",
    quality: excluded || approximate ? "approx" : "exact",
    provenance: "inferred",
    ...(excluded
      ? { note: `合计排除了 ${excluded} 个历史重叠证据不足的分叉会话` }
      : {}),
  };
}
