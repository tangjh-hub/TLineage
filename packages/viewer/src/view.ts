import { handoffCard } from "./handoff-card.js";
import type { Translate } from "./i18n.js";
import {
  badges,
  fitLaneLabel,
  clusters,
  foldSubagents,
  labels,
  laneLabels,
  mapLayout,
  visibleSessions,
  type Box,
  type Camera,
  type PlotNode,
} from "./layout.js";
import type {
  Filter,
  Language,
  MapData,
  MapHandoff,
  MapProject,
  MapSession,
  MapUsage,
} from "./types.js";

export interface ViewerState {
  project: number;
  filter: Filter;
  list: boolean;
  showSubagents: boolean;
  selected?: string;
  hovered?: string;
  focused?: string;
  camera: Camera;
  expanded: Set<string>;
}

const palette = [
  "#8FB4FF",
  "#FF9D80",
  "#C3A6FF",
  "#6FC9D8",
  "#F29FC2",
  "#B7D98B",
  "#9AA0AA",
];
const NS = "http://www.w3.org/2000/svg";
const filters = ["all", "active", "stalled", "done"] as const;

function html<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text?: string,
  className?: string,
) {
  const item = document.createElement(tag);
  if (text !== undefined) item.textContent = text;
  if (className) item.className = className;
  return item;
}

function svg<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attributes: Record<string, string | number> = {},
  text?: string,
) {
  const item = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attributes))
    item.setAttribute(key, String(value));
  if (text !== undefined) item.textContent = text;
  return item;
}

function required<T extends Element>(root: ParentNode, selector: string) {
  return root.querySelector<T>(selector)!;
}

const empty: MapProject = { label: "", sessions: [], lanes: [], edges: [] };

export function createView(
  root: HTMLElement,
  data: MapData,
  lang: Language,
  t: Translate,
) {
  const embedsHandoff = data.projects.some((project) =>
    project.lanes.some((lane) => lane.handoff),
  );
  const cards = new WeakMap<MapHandoff, HTMLElement>();
  root.innerHTML = `
    <a class="skip" href="#main">${t("skip")}</a>
    <div class="shell">
      <aside class="rail">
        <div class="brand"><svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><path d="M4 4l10 5L4 14" fill="none" stroke="#55555B"/><circle cx="4" cy="4" r="2.5" fill="#7CE3C0"/><circle cx="14" cy="9" r="2.5" fill="#ECECEE"/><circle cx="4" cy="14" r="2.5" fill="#ECECEE"/></svg>${t("brand")}</div>
        <div class="project"><label for="project-select">${t("workspace")}</label><select id="project-select"></select></div>
        <div class="nav" aria-current="page">${t("map")}</div>
        <div class="rail-stats" id="rail-stats"></div>
      </aside>
      <main id="main" class="main" tabindex="-1">
        <header class="head">
          <div><h1>${t("map")}</h1><div class="subtitle"><span id="date-range"></span><span class="demo" id="demo-badge" hidden>${t("demo")}</span></div></div>
          <div class="filters">${filters.map((f) => `<button type="button" data-filter="${f}">${t(f)}</button>`).join("")}</div>
        </header>
        <section class="board">
          <div class="tools">
            <label><input id="show-subagents" type="checkbox">${t("showSubagents")}</label>
            <div class="zoom">
              <button id="view-toggle" type="button"></button>
              <button type="button" data-camera="out" aria-label="${t("zoomOut")}" title="${t("zoomOut")}">−</button>
              <button type="button" data-camera="in" aria-label="${t("zoomIn")}" title="${t("zoomIn")}">+</button>
              <button type="button" data-camera="reset" aria-label="${t("reset")}" title="${t("reset")}">0</button>
            </div>
          </div>
          <div id="chart" class="chart" aria-label="${t("mapView")}" aria-describedby="map-controls"></div>
          <div id="session-list" class="list" hidden></div>
          <div class="legend"><span>${t("legendSize")}</span><span>${t("legendLines")}</span><span><i></i>${t("legendWarning")}</span></div>
        </section>
        <p class="controls" id="map-controls"></p>
        <footer class="footer">${t("share")}${embedsHandoff ? " " + t("shareHandoff") : ""}</footer>
      </main>
      <aside id="inspector" class="inspector" aria-label="${t("details")}"></aside>
    </div>
    <div id="tooltip" class="tooltip" role="tooltip" hidden></div>`;
  const select = required<HTMLSelectElement>(root, "#project-select");
  const chart = required<HTMLDivElement>(root, "#chart");
  const list = required<HTMLDivElement>(root, "#session-list");
  const inspector = required<HTMLElement>(root, "#inspector");
  const tooltip = required<HTMLDivElement>(root, "#tooltip");
  const viewToggle = required<HTMLButtonElement>(root, "#view-toggle");
  const subagents = required<HTMLInputElement>(root, "#show-subagents");
  const controls = required<HTMLElement>(root, "#map-controls");
  const number = new Intl.NumberFormat(lang === "zh" ? "zh-CN" : "en");
  const day = new Intl.DateTimeFormat(lang === "zh" ? "zh-CN" : "en", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
  const format = (value: string | number) =>
    Number.isFinite(new Date(value).getTime())
      ? day.format(new Date(value))
      : t("noDate");
  const tokenText = (usage: MapUsage) =>
    (usage.approximate ? "≈" : "") +
    number.format(usage.total) +
    " " +
    t("tokens");
  const title = (session: MapSession) => session.title || t("untitled");
  const getProject = (state: ViewerState) =>
    data.projects[state.project] ?? empty;
  const metadata = (session: MapSession) =>
    `${t("codex")} · ${format(session.startedAt)} · ${t("fileCount", session.fileCount)}`;
  const accessibility = (session: MapSession, usage: MapUsage, count: number) =>
    [
      title(session),
      metadata(session),
      t(session.status),
      tokenText(usage),
      count ? t("subagents", count) : "",
    ]
      .filter(Boolean)
      .join(" · ");

  for (const [index, project] of data.projects.entries()) {
    const option = html(
      "option",
      data.demo ? t("demoWorkspace") : project.label || t("noWorkspace"),
    );
    option.value = String(index);
    select.append(option);
  }
  if (!data.projects.length) select.append(html("option", t("noWorkspace")));
  select.disabled = data.projects.length < 2;
  required(root, "#demo-badge").toggleAttribute("hidden", !data.demo);

  let current = empty;
  let folded = foldSubagents([]);
  let laneNames = new Map<string, string>();
  let sessions: MapSession[] = [];
  let nodes: PlotNode[] = [];
  let bySession = new Map<string, MapSession>();
  let plot: ReturnType<typeof mapLayout> | undefined;
  let width = 0;
  let height = 0;
  let labelLayer: SVGGElement | undefined;
  let reserved: Box[] = [];

  function ensureProject(project: MapProject) {
    if (project === current) return;
    current = project;
    folded = foldSubagents(project.sessions);
    laneNames = laneLabels(project);
    bySession = new Map(
      project.sessions.map((session) => [session.id, session]),
    );
  }

  function numbers(session: MapSession, details: boolean) {
    const usage = html("dl", undefined, "numbers");
    const add = (label: string, value: string) =>
      usage.append(html("dt", label), html("dd", value));
    const rollup = folded.totals.get(session.id);
    add(t("own"), tokenText(session.usage));
    if (rollup?.count) add(t("rolledUp"), tokenText(rollup.usage));
    if (session.threadCumulative !== undefined)
      add(
        t("cumulative"),
        number.format(session.threadCumulative) + " " + t("tokens"),
      );
    if (details) {
      add(t("input"), number.format(session.usage.input));
      add(t("output"), number.format(session.usage.output));
    }
    return usage;
  }

  function detail(state: ViewerState) {
    inspector.replaceChildren();
    const session = state.selected && bySession.get(state.selected);
    if (!session) {
      inspector.append(html("p", t("select"), "muted"));
      return;
    }
    const meta = html("div", undefined, "meta");
    const pill = html("span", t(session.status), "pill");
    pill.dataset.status = session.status;
    meta.append(
      pill,
      html(
        "span",
        `${t("codex")} · ${format(session.startedAt)} · ${laneNames.get(session.lane) ?? t("lane")}`,
      ),
    );
    inspector.append(
      meta,
      html("h2", title(session)),
      html("p", session.gist ?? t("noDescription"), "muted"),
    );
    const usage = html("section", undefined, "section");
    usage.append(html("h3", t("usage")), numbers(session, true));
    inspector.append(usage);
    const files = html("section", undefined, "section");
    const fileList = html("ul", undefined, "files");
    for (const path of session.files) fileList.append(html("li", path));
    const more = session.fileCount - session.files.length;
    if (more > 0) fileList.append(html("li", t("moreFiles", more), "muted"));
    files.append(
      html("h3", t("files")),
      session.fileCount ? fileList : html("p", t("fileCount", 0), "muted"),
    );
    inspector.append(files);
    const related = current.edges.filter(
      (edge) => edge.from === session.id || edge.to === session.id,
    );
    if (related.length) {
      const links = html("section", undefined, "section");
      const ul = html("ul");
      for (const edge of related) {
        const other = bySession.get(
          edge.from === session.id ? edge.to : edge.from,
        );
        if (!other) continue;
        const item = html(
          "li",
          `${edge.to === session.id ? "←" : "→"} ${title(other)} · ${t(edge.kind)} · ${t("verified")}`,
        );
        if (edge.evidence.length)
          item.append(html("div", edge.evidence.join(" · "), "muted files"));
        ul.append(item);
      }
      links.append(html("h3", t("relations")), ul);
      inspector.append(links);
    }
    const pack = current.lanes.find(
      (lane) => lane.id === session.lane,
    )?.handoff;
    if (pack) {
      let card = cards.get(pack);
      if (!card) {
        card = handoffCard(pack, t, lang);
        cards.set(pack, card);
      }
      inspector.append(card);
    } else {
      const handoff = html("section", undefined, "handoff");
      handoff.append(
        html("h3", t("handoff")),
        html("p", t("handoffUnavailable")),
      );
      inspector.append(handoff);
    }
  }

  const canvas = html("canvas");
  const context = canvas.getContext("2d");
  if (context)
    context.font =
      "11px " +
      getComputedStyle(document.documentElement)
        .getPropertyValue("--font")
        .trim();
  const measure = (value: string) =>
    context?.measureText(value).width ?? Array.from(value).length * 11;

  function paintLabels(state: ViewerState) {
    if (!labelLayer || !plot) return;
    const pinned = [state.selected, state.hovered, state.focused];
    const placed = labels(
      nodes,
      (node) => {
        const value = title(node.stars[0].session);
        const letters = Array.from(value);
        return letters.length > 25
          ? letters.slice(0, 24).join("") + "…"
          : value;
      },
      measure,
      {
        x: plot.left,
        y: 0,
        width: Math.max(1, width - plot.left - 4),
        height: plot.axisY - 3,
      },
      pinned,
      reserved,
    );
    labelLayer.replaceChildren(
      ...placed.map((item) =>
        svg(
          "text",
          {
            x: item.x + 4,
            y: item.y + 12,
            class: "plot-label",
            "data-label": item.id,
            "data-x": item.x,
            "data-y": item.y,
            "data-width": item.width,
            "data-height": item.height,
          },
          item.text,
        ),
      ),
    );
  }

  function showTooltip(id: string | undefined, anchor?: Element) {
    tooltip.hidden = true;
    tooltip.replaceChildren();
    if (!id || !anchor) return;
    const node = nodes.find((item) => item.id === id);
    if (node && node.stars.length > 1)
      tooltip.append(
        html("h3", t("grouped", node.stars.length)),
        html("p", t("expand", node.stars.length)),
      );
    else {
      const session = bySession.get(id);
      if (!session) return;
      tooltip.append(
        html("h3", title(session)),
        html("p", metadata(session), "meta"),
      );
      if (session.gist) tooltip.append(html("p", session.gist, "muted"));
      tooltip.append(numbers(session, false));
    }
    positionTooltip(anchor);
  }

  function positionTooltip(anchor: Element) {
    tooltip.hidden = false;
    const rect = anchor.getBoundingClientRect();
    const tip = tooltip.getBoundingClientRect();
    tooltip.style.left =
      Math.max(
        8,
        Math.min(
          rect.left + rect.width / 2 + 10,
          window.innerWidth - tip.width - 8,
        ),
      ) + "px";
    tooltip.style.top =
      Math.max(
        8,
        Math.min(rect.bottom + 8, window.innerHeight - tip.height - 8),
      ) + "px";
  }

  function drawList(state: ViewerState) {
    list.replaceChildren();
    if (!sessions.length) {
      list.append(html("p", t("empty"), "empty"));
      return;
    }
    const table = html("table");
    const header = html("tr");
    for (const column of [
      "session",
      "lane",
      "date",
      "state",
      "usage",
    ] as const) {
      const cell = html("th", t(column));
      cell.scope = "col";
      header.append(cell);
    }
    const head = html("thead");
    head.append(header);
    const rows = html("tbody");
    for (const session of sessions) {
      const row = html("tr");
      row.dataset.selected = String(session.id === state.selected);
      const button = html("button", title(session));
      button.type = "button";
      button.dataset.node = session.id;
      const rolled = folded.totals.get(session.id)!;
      const usage = state.showSubagents
        ? session.contribution === null
          ? { ...session.usage, total: 0, approximate: true }
          : (session.contribution ?? session.usage)
        : rolled.usage;
      button.setAttribute(
        "aria-label",
        accessibility(session, usage, rolled.count),
      );
      button.setAttribute("aria-describedby", "tooltip");
      const first = html("td");
      first.append(button);
      if (rolled.count && !state.showSubagents)
        first.append(html("span", t("subagents", rolled.count), "muted"));
      row.append(
        first,
        html("td", laneNames.get(session.lane)),
        html("td", format(session.startedAt)),
        html("td", t(session.status)),
        html("td", tokenText(usage)),
      );
      rows.append(row);
    }
    table.append(head, rows);
    list.append(table);
  }

  function drawMap(state: ViewerState) {
    chart.replaceChildren();
    labelLayer = undefined;
    reserved = [];
    nodes = [];
    if (!sessions.length) {
      chart.append(html("p", t("empty"), "empty"));
      return;
    }
    width = Math.max(1, chart.clientWidth);
    height = Math.max(1, chart.clientHeight);
    const shownLanes = new Set(sessions.map((session) => session.lane));
    const laneIds = current.lanes
      .map((lane) => lane.id)
      .filter((id) => shownLanes.has(id));
    const colors = new Map(
      current.lanes.map((lane, index) => [
        lane.id,
        palette[index % palette.length],
      ]),
    );
    plot = mapLayout(
      sessions,
      laneIds,
      folded,
      state.showSubagents,
      width,
      height,
      state.camera,
    );
    const axisY = plot.axisY;
    const left = plot.left;
    const surface = svg("svg", {
      viewBox: `0 0 ${width} ${height}`,
      role: "group",
      "aria-label": t("mapView"),
    });
    const defs = svg("defs");
    const glow = svg("filter", {
      id: "glow",
      x: "-100%",
      y: "-100%",
      width: "300%",
      height: "300%",
    });
    glow.append(svg("feGaussianBlur", { stdDeviation: 4 }));
    const clip = svg("clipPath", { id: "plot-clip" });
    clip.append(
      svg("rect", {
        x: left - 12,
        y: 0,
        width: Math.max(1, width - left + 12),
        height: Math.max(1, axisY - 4),
      }),
    );
    defs.append(glow, clip);
    surface.append(defs);
    for (let index = 1; index <= 56; index++) {
      surface.append(
        svg("circle", {
          cx: (index * 149.13) % width,
          cy: (index * 91.27) % axisY,
          r: index % 9 ? 0.55 : 1,
          fill: "#ECECEE",
          opacity: 0.14,
          "aria-hidden": "true",
        }),
      );
    }
    let previousTick = -Infinity;
    for (const { time, x } of plot.ticks) {
      if (x < left - 8 || x > width - 20 || x - previousTick < 56) continue;
      previousTick = x;
      surface.append(
        svg("line", {
          x1: x,
          x2: x,
          y1: 8,
          y2: axisY,
          stroke: "#191A21",
          opacity: 0.8,
        }),
      );
      surface.append(
        svg(
          "text",
          { x, y: axisY + 18, "text-anchor": "middle", class: "axis" },
          format(time),
        ),
      );
    }
    surface.append(
      svg("line", {
        x1: left - 8,
        x2: width - 12,
        y1: axisY,
        y2: axisY,
        stroke: "#232327",
      }),
    );
    let previousBreak = -Infinity;
    for (const x of plot.breaks) {
      if (x < left || x > width - 10 || x - previousBreak < 14) continue;
      previousBreak = x;
      const marker = svg("path", {
        d: `M${x - 5} ${axisY + 4}l4 -8m2 8 4 -8`,
        stroke: "#8E8E93",
        fill: "none",
      });
      marker.append(svg("title", {}, t("axisBreak")));
      surface.append(marker);
    }
    let previousBand = -Infinity;
    for (const { id, y } of plot.bands) {
      if (y < 9 || y > axisY - 10 || y - previousBand < 16) continue;
      previousBand = y;
      const full = laneNames.get(id) ?? "";
      const fitted = fitLaneLabel(full, left - 20, measure);
      const label = svg(
        "text",
        {
          x: 12,
          y: y + 4,
          fill: colors.get(id) ?? "#9AA0AA",
          class: "band-name",
        },
        fitted,
      );
      if (fitted !== full) {
        label.setAttribute("tabindex", "0");
        label.setAttribute("aria-label", full);
        label.setAttribute("style", "pointer-events:auto");
        const reveal = () => {
          tooltip.replaceChildren(html("h3", full));
          positionTooltip(label);
        };
        label.addEventListener("pointerenter", reveal);
        label.addEventListener("focus", reveal);
        label.addEventListener("pointerleave", () => {
          if (document.activeElement !== label) showTooltip(undefined);
        });
        label.addEventListener("blur", () => {
          if (!label.matches(":hover")) showTooltip(undefined);
        });
      }
      surface.append(label);
    }

    const all = clusters(plot.stars, state.expanded);
    const layer = svg("g", { "clip-path": "url(#plot-clip)" });
    const byNode = new Map(
      all.flatMap((node) =>
        node.stars.map((star) => [star.session.id, node] as const),
      ),
    );
    const bands = new Map<string, PlotNode[]>();
    for (const node of all) {
      const line = bands.get(node.lane) ?? [];
      line.push(node);
      bands.set(node.lane, line);
    }
    for (const [id, line] of bands) {
      if (line.length < 2) continue;
      layer.append(
        svg("polyline", {
          points: line.map(({ x, y }) => `${x},${y}`).join(" "),
          fill: "none",
          stroke: colors.get(id) ?? "#9AA0AA",
          "stroke-width": 1,
          opacity: 0.55,
        }),
      );
    }
    function endpoint(id: string) {
      if (!state.showSubagents)
        while (folded.parents.has(id)) id = folded.parents.get(id)!;
      return byNode.get(id);
    }
    const pairs = new Set<string>();
    for (const edge of current.edges) {
      const from = endpoint(edge.from);
      const to = endpoint(edge.to);
      if (!from || !to || from.id === to.id) continue;
      const key = from.id + "/" + to.id;
      if (pairs.has(key)) continue;
      pairs.add(key);
      const mid = (from.x + to.x) / 2;
      layer.append(
        svg("path", {
          d: `M${from.x} ${from.y}C${mid} ${from.y} ${mid} ${to.y} ${to.x} ${to.y}`,
          fill: "none",
          stroke: "#ECECEE",
          "stroke-width": 1.2,
          opacity: from.lane === to.lane ? 0.19 : 0.45,
        }),
      );
    }
    nodes = all.filter(
      ({ x, y }) =>
        x >= left - 10 && x <= width - 3 && y >= 3 && y <= axisY - 5,
    );
    for (const node of nodes) {
      const session = node.stars[0].session;
      const group = node.stars.length > 1;
      const selected = node.stars.some(
        (star) => star.session.id === state.selected,
      );
      const color =
        !group && session.status === "warn"
          ? "#E8B36A"
          : (colors.get(node.lane) ?? "#9AA0AA");
      const descendants = folded.totals.get(session.id)?.count ?? 0;
      const star = svg("g", {
        transform: `translate(${node.x} ${node.y})`,
        class: "star",
        role: "button",
        tabindex: 0,
        "data-node": node.id,
        "aria-label": group
          ? t("expand", node.stars.length)
          : accessibility(session, node.stars[0].usage, descendants),
        "aria-describedby": "tooltip",
        "aria-pressed": String(selected),
      });
      const circle = (r: number, attrs: Record<string, string | number>) =>
        svg("circle", { r, ...attrs });
      star.append(
        circle(Math.max(11, node.r + 3), {
          fill: "transparent",
          "pointer-events": "all",
        }),
      );
      star.append(
        circle(node.r + 10, {
          fill: "none",
          stroke: "#ECECEE",
          "stroke-width": 1.5,
          class: "focus-ring",
          "pointer-events": "none",
        }),
      );
      const dimmed = !group && session.status === "idle" ? 0.5 : 1;
      const hollow = !group && session.status === "open";
      star.append(
        circle(2.2 * node.r, {
          fill: color,
          opacity: hollow ? 0.12 : 0.35 * dimmed,
          filter: "url(#glow)",
          "pointer-events": "none",
        }),
      );
      star.append(
        circle(node.r, {
          fill: group || hollow ? "#07080D" : "#ECECEE",
          stroke: color,
          "stroke-width": hollow || group ? 2 : 1,
          opacity: dimmed,
        }),
      );
      if (selected)
        star.append(
          circle(node.r + 7, {
            fill: "none",
            stroke: "#ECECEE",
            "stroke-width": 1,
            "pointer-events": "none",
          }),
        );
      if (group)
        star.append(
          svg(
            "text",
            {
              x: 0,
              y: 4,
              "text-anchor": "middle",
              fill: "#ECECEE",
              "font-size": 10,
              "pointer-events": "none",
            },
            String(node.stars.length),
          ),
        );
      layer.append(star);
    }
    surface.append(layer);
    if (!state.showSubagents) {
      const items = badges(
        nodes,
        (node) => {
          const count = folded.totals.get(node.id)?.count ?? 0;
          return node.stars.length === 1 && count
            ? t("subagents", count)
            : undefined;
        },
        measure,
        { x: left - 8, y: 3, width: width - left + 4, height: axisY - 9 },
        state.selected,
      );
      reserved = items;
      const badgeLayer = svg("g", {
        "aria-hidden": "true",
        "pointer-events": "none",
      });
      for (const item of items) {
        const color = colors.get(item.node.lane) ?? "#9AA0AA";
        const middle = item.x + item.width / 2;
        const bottom = item.y + item.height;
        const above = bottom <= item.node.y;
        badgeLayer.append(
          svg("line", {
            x1: item.node.x,
            y1: item.node.y + (above ? -item.node.r : item.node.r),
            x2: Math.max(
              item.x + 4,
              Math.min(item.x + item.width - 4, item.node.x),
            ),
            y2: above ? bottom : item.y,
            stroke: color,
            opacity: 0.55,
          }),
        );
        badgeLayer.append(
          svg("rect", {
            x: item.x,
            y: item.y,
            width: item.width,
            height: item.height,
            rx: 6,
            fill: "#111113",
            stroke: color,
            opacity: 0.98,
            "data-badge": item.node.id,
          }),
        );
        badgeLayer.append(
          svg(
            "text",
            {
              x: middle,
              y: item.y + 10,
              "text-anchor": "middle",
              fill: "#ECECEE",
              "font-size": 10,
            },
            item.text,
          ),
        );
      }
      surface.append(badgeLayer);
    }
    labelLayer = svg("g", { "aria-hidden": "true" });
    surface.append(labelLayer);
    chart.append(surface);
    paintLabels(state);
  }

  function render(state: ViewerState) {
    ensureProject(getProject(state));
    sessions = visibleSessions(
      current,
      state.showSubagents,
      state.filter,
      folded,
    );
    select.value = String(state.project);
    subagents.checked = state.showSubagents;
    viewToggle.textContent = t(state.list ? "mapView" : "list");
    viewToggle.setAttribute("aria-pressed", String(state.list));
    root
      .querySelectorAll<HTMLButtonElement>("[data-filter]")
      .forEach((button) =>
        button.setAttribute(
          "aria-pressed",
          String(button.dataset.filter === state.filter),
        ),
      );
    root
      .querySelectorAll<HTMLButtonElement>("[data-camera]")
      .forEach((button) => {
        button.disabled = state.list;
      });
    chart.hidden = state.list;
    list.hidden = !state.list;
    required(root, "#rail-stats").textContent =
      `${t("sessionCount", current.sessions.length)}\n${t("laneCount", current.lanes.length)}`;
    const dated = sessions.filter((item) => item.startedAt);
    required(root, "#date-range").textContent = dated.length
      ? `${format(dated[0].startedAt)} – ${format(dated.at(-1)!.startedAt)}`
      : t("sessionCount", sessions.length);
    controls.textContent =
      state.list && current.defaultList
        ? t("listDefault")
        : state.list
          ? ""
          : t("controls") + " · " + t("keyboard");
    if (state.list) {
      nodes = [];
      drawList(state);
    } else drawMap(state);
    detail(state);
  }
  return {
    chart,
    list,
    select,
    subagents,
    viewToggle,
    render,
    showTooltip,
    paintLabels,
    visible: () => sessions,
    nodes: () => nodes,
  };
}

export type View = ReturnType<typeof createView>;
