import { language, translate } from "./i18n.js";
import { bindInteractions } from "./interactions.js";
import type { MapData } from "./types.js";
import { createView } from "./view.js";

const payload = document.querySelector<HTMLScriptElement>("#tlineage-data")!;
const root = document.querySelector<HTMLElement>("#app")!;
const data = JSON.parse(payload.textContent ?? "{}") as MapData;
const lang = language(data.lang, navigator.language);
document.documentElement.lang = lang;
const t = translate(lang);
document.title = t("brand") + " · " + t("map");
bindInteractions(root, createView(root, data, lang, t), data);
