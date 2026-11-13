import {
  defaultListLimit,
  initialSession,
  neighbor,
  resetCamera,
  visibleSessions,
  zoomCamera,
} from "./layout.js";
import type { Filter, MapData } from "./types.js";
import type { View, ViewerState } from "./view.js";

const directions: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

export function bindInteractions(root: HTMLElement, view: View, data: MapData) {
  const state: ViewerState = {
    project: 0,
    filter: "all",
    list: false,
    showSubagents: false,
    camera: { ...resetCamera },
    expanded: new Set(),
  };
  let explicitView = false;
  let suppressClickUntil = 0;
  let frame = 0;
  const pointers = new Map<number, { x: number; y: number }>();

  const allNodes = () =>
    [...root.querySelectorAll<Element>("[data-node]")].filter(
      (item) => !item.closest("[hidden]"),
    );
  const findNode = (id: string | undefined) =>
    id === undefined
      ? undefined
      : allNodes().find((item) => item.getAttribute("data-node") === id);
  const eventNode = (target: EventTarget | null) =>
    target instanceof Element ? target.closest("[data-node]") : null;
  function feedback() {
    const id = state.hovered ?? state.focused;
    view.showTooltip(id, findNode(id));
    view.paintLabels(state);
  }
  function render(focusId?: string) {
    state.hovered = undefined;
    state.focused = undefined;
    view.render(state);
    if (focusId) {
      const element = findNode(focusId);
      if (element instanceof HTMLElement || element instanceof SVGElement)
        element.focus({ preventScroll: !state.list });
    }
    feedback();
  }
  function schedule() {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      const active =
        eventNode(document.activeElement)?.getAttribute("data-node") ??
        undefined;
      render(active);
    });
  }
  function reconcile() {
    const project = data.projects[state.project];
    const sessions = project
      ? visibleSessions(project, state.showSubagents, state.filter)
      : [];
    if (!sessions.some((session) => session.id === state.selected))
      state.selected = initialSession(sessions);
  }
  function reset() {
    state.camera = { ...resetCamera };
    state.expanded.clear();
  }
  function load(index: number) {
    if (index < 0 || index >= data.projects.length) return;
    state.project = index;
    state.filter = "all";
    state.showSubagents = false;
    state.selected = undefined;
    explicitView = false;
    state.list = Boolean(data.projects[index].defaultList);
    reset();
    reconcile();
    render();
  }
  function selectNode(id: string, focus: boolean) {
    const node = view.nodes().find((item) => item.id === id);
    if (node && node.stars.length > 1) {
      state.expanded.add(id);
      if (!node.stars.some(({ session }) => session.id === state.selected))
        state.selected = node.stars[0].session.id;
    } else state.selected = id;
    render(focus ? state.selected : undefined);
  }
  function zoom(factor: number, x?: number, y?: number) {
    const chart = view.chart.getBoundingClientRect();
    state.camera = zoomCamera(
      state.camera,
      factor,
      x ?? chart.width / 2,
      y ?? chart.height / 2,
      chart.width,
    );
    state.expanded.clear();
    schedule();
  }

  view.select.addEventListener("change", () => load(Number(view.select.value)));
  view.subagents.addEventListener("change", () => {
    state.showSubagents = view.subagents.checked;
    const project = data.projects[state.project];
    if (!explicitView && project)
      state.list =
        visibleSessions(project, state.showSubagents, "all").length >
        defaultListLimit;
    reset();
    reconcile();
    render();
  });
  root.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const control = target?.closest("button");
    const filter = control?.getAttribute("data-filter");
    if (filter) {
      state.filter = filter as Filter;
      reset();
      reconcile();
      render();
      return;
    }
    if (control === view.viewToggle) {
      explicitView = true;
      state.list = !state.list;
      render();
      return;
    }
    const camera = control?.getAttribute("data-camera");
    if (camera === "reset") {
      reset();
      render();
      return;
    }
    if (camera) {
      zoom(camera === "in" ? 1.25 : 0.8);
      return;
    }
    const node = eventNode(target);
    const id = node?.getAttribute("data-node");
    if (id && performance.now() >= suppressClickUntil)
      selectNode(id, event.detail === 0);
  });

  root.addEventListener("pointerover", (event) => {
    const id = eventNode(event.target)?.getAttribute("data-node");
    if (!id || id === state.hovered || pointers.size) return;
    state.hovered = id;
    feedback();
  });
  root.addEventListener("pointerout", (event) => {
    const id = eventNode(event.target)?.getAttribute("data-node");
    if (
      !id ||
      id !== state.hovered ||
      eventNode(event.relatedTarget)?.getAttribute("data-node") === id
    )
      return;
    state.hovered = undefined;
    feedback();
  });
  root.addEventListener("focusin", (event) => {
    const id = eventNode(event.target)?.getAttribute("data-node");
    if (!id) return;
    state.focused = id;
    state.hovered = undefined;
    feedback();
  });
  root.addEventListener("focusout", (event) => {
    if (!eventNode(event.target)) return;
    state.focused = undefined;
    feedback();
  });

  root.addEventListener("keydown", (event) => {
    const node = eventNode(event.target);
    const id = node?.getAttribute("data-node");
    if (event.key === "Escape") {
      state.focused = state.hovered = undefined;
      feedback();
      return;
    }
    if (
      event.key === "0" &&
      !state.list &&
      !(event.target instanceof HTMLSelectElement)
    ) {
      event.preventDefault();
      reset();
      render(id ?? undefined);
      return;
    }
    if (
      node instanceof SVGElement &&
      id &&
      (event.key === "Enter" || event.key === " ")
    ) {
      event.preventDefault();
      selectNode(id, true);
      return;
    }
    const direction = directions[event.key];
    if (!direction || !id) return;
    event.preventDefault();
    const [dx, dy] = direction;
    if (event.shiftKey && !state.list) {
      state.camera.x -= dx * 40;
      state.camera.y -= dy * 40;
      schedule();
      return;
    }
    const shown = view.visible();
    const next = state.list
      ? shown[shown.findIndex((session) => session.id === id) + (dy || dx)]?.id
      : neighbor(view.nodes(), id, dx, dy);
    const target = findNode(next);
    if (target instanceof HTMLElement || target instanceof SVGElement)
      target.focus({ preventScroll: !state.list });
  });

  view.chart.addEventListener(
    "wheel",
    (event) => {
      if (!event.ctrlKey || state.list) return;
      event.preventDefault();
      const bounds = view.chart.getBoundingClientRect();
      zoom(
        Math.exp(-event.deltaY * 0.004),
        event.clientX - bounds.left,
        event.clientY - bounds.top,
      );
    },
    { passive: false },
  );

  let dragging = false;
  let travel = 0;
  view.chart.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || state.list) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size === 1) travel = 0;
  });
  view.chart.addEventListener("pointermove", (event) => {
    const previous = pointers.get(event.pointerId);
    if (!previous) return;
    const next = { x: event.clientX, y: event.clientY };
    const other = [...pointers].find(([id]) => id !== event.pointerId)?.[1];
    pointers.set(event.pointerId, next);
    travel += Math.hypot(next.x - previous.x, next.y - previous.y);
    if (!other && travel < 4) return;
    dragging = true;
    view.chart.classList.add("dragging");
    if (!view.chart.hasPointerCapture(event.pointerId))
      view.chart.setPointerCapture(event.pointerId);
    if (other) {
      const before = Math.hypot(other.x - previous.x, other.y - previous.y);
      const after = Math.hypot(other.x - next.x, other.y - next.y);
      const box = view.chart.getBoundingClientRect();
      if (before > 0 && after > 0)
        zoom(
          after / before,
          (other.x + next.x) / 2 - box.left,
          (other.y + next.y) / 2 - box.top,
        );
    } else {
      state.camera.x += next.x - previous.x;
      state.camera.y += next.y - previous.y;
      schedule();
    }
  });
  function endPointer(event: PointerEvent) {
    if (!pointers.delete(event.pointerId) || pointers.size) return;
    if (dragging) suppressClickUntil = performance.now() + 180;
    dragging = false;
    view.chart.classList.remove("dragging");
  }
  window.addEventListener("pointerup", endPointer);
  window.addEventListener("pointercancel", endPointer);
  new ResizeObserver(() => {
    if (!state.list) schedule();
  }).observe(view.chart);
  if (data.projects.length) load(0);
  else render();
}
