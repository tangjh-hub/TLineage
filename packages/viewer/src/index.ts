import { readFile } from "node:fs/promises";
import { defaultListLimit, visibleSessions } from "./layout.js";
import { styles } from "./styles.js";
import type { MapData } from "./types.js";

export { mapData } from "./data.js";
export { demoData } from "./demo.js";
export { messages as viewerMessages } from "./i18n.js";

const escapeData = (value: MapData) =>
  JSON.stringify(value).replace(
    /[<>&\u2028\u2029]/g,
    (character) =>
      "\\u" + character.charCodeAt(0).toString(16).padStart(4, "0"),
  );

export function inlineMap(data: MapData, browserCode: string) {
  const initial: MapData = {
    ...data,
    projects: data.projects.map((project) => ({
      ...project,
      defaultList:
        visibleSessions(project, false, "all").length > defaultListLimit,
    })),
  };
  return `<!doctype html>
<html lang="${data.lang ?? "en"}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<title>TLineage</title>
<style>${styles}</style>
</head>
<body>
<div id="app"></div>
<script id="tlineage-data" type="application/json">${escapeData(initial)}</script>
<script>${browserCode.replace(/<\/script/gi, "<\\/script")}</script>
</body>
</html>
`;
}

export async function renderMap(data: MapData) {
  const browser = await readFile(
    new URL("./viewer-assets/browser.global.js", import.meta.url),
    "utf8",
  );
  return inlineMap(data, browser);
}
