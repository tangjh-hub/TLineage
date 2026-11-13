import type { Translate } from "./i18n.js";
import type { Language, MapHandoff } from "./types.js";

const targets = [
  ["handoffClaude", "handoffHintClaude"],
  ["handoffCodex", "handoffHintCodex"],
  ["handoffMarkdown", "handoffHintMarkdown"],
] as const;

export function handoffTargetText(text: string, hint: string) {
  const lines = text.split("\n");
  if (lines[0]?.startsWith("# Handoff") && lines[1]?.startsWith("> ")) {
    lines[1] = "> " + hint;
    return lines.join("\n");
  }
  return text;
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  return node;
}

export function handoffCardTime(
  value: string,
  lang: Language,
  timeZone?: string,
) {
  return new Intl.DateTimeFormat(lang === "zh" ? "zh-CN" : "en", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone,
    timeZoneName: "longOffset",
  })
    .format(new Date(value))
    .replace("GMT", "UTC")
    .replace(/UTC[+-]00:00/g, "UTC");
}

export function handoffCard(pack: MapHandoff, t: Translate, lang: Language) {
  const card = element("section");
  card.className = "handoff";
  const tabs = element("div");
  tabs.setAttribute("role", "tablist");
  tabs.setAttribute("aria-label", t("handoff"));
  const preview = element("textarea");
  preview.id = "handoff-preview";
  preview.className = "handoff-preview";
  preview.rows = 14;
  preview.spellcheck = false;
  preview.setAttribute("aria-label", t("handoffPreview"));
  preview.addEventListener("keydown", (event) => {
    if (event.key === "0") event.stopPropagation();
  });
  preview.value = pack.markdown;

  let active = 2;
  const buttons = targets.map(([label], index) => {
    const button = element("button", t(label));
    button.type = "button";
    button.setAttribute("role", "tab");
    button.addEventListener("click", () => select(index));
    button.addEventListener("keydown", (event) => {
      const next = {
        ArrowLeft: (active + buttons.length - 1) % buttons.length,
        ArrowRight: (active + 1) % buttons.length,
        Home: 0,
        End: buttons.length - 1,
      }[event.key];
      if (next === undefined) return;
      event.preventDefault();
      select(next);
      buttons[next].focus();
    });
    return button;
  });
  tabs.style.cssText =
    "display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:4px;margin:8px 0";
  tabs.append(...buttons);

  const result = element("p");
  result.setAttribute("role", "status");
  function select(index: number) {
    active = index;
    for (const [position, button] of buttons.entries()) {
      button.setAttribute("aria-selected", String(position === active));
      button.setAttribute("aria-pressed", String(position === active));
      button.tabIndex = position === active ? 0 : -1;
    }
    preview.value = handoffTargetText(preview.value, t(targets[active][1]));
    result.textContent = "";
  }
  select(active);

  const copy = element("button", t("copyHandoff"));
  copy.type = "button";
  copy.addEventListener("click", async () => {
    try {
      if (!navigator.clipboard) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(preview.value);
      result.textContent = t("handoffCopied");
    } catch {
      preview.focus();
      preview.select();
      try {
        result.textContent = document.execCommand("copy")
          ? t("handoffCopied")
          : t("handoffManual");
      } catch {
        result.textContent = t("handoffManual");
      }
    }
  });
  const expand = element("button", t("handoffExpand"));
  expand.type = "button";
  expand.setAttribute("aria-controls", preview.id);
  expand.setAttribute("aria-expanded", "false");
  expand.addEventListener("click", () => {
    const expanded = expand.getAttribute("aria-expanded") !== "true";
    expand.setAttribute("aria-expanded", String(expanded));
    expand.textContent = t(expanded ? "handoffCollapse" : "handoffExpand");
    preview.rows = expanded ? 28 : 14;
    // Clear a manual resize when switching between the two presets.
    preview.style.removeProperty("height");
  });
  const time = handoffCardTime(pack.generatedAt, lang);
  card.append(
    element("h3", t("handoff")),
    element("p", t("handoffGenerated").replace("{time}", time)),
    tabs,
    expand,
    preview,
    copy,
    result,
  );
  return card;
}
