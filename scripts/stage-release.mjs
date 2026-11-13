import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  writeFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { generateNotices } from "./release-notices.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const destination = process.argv[2];
if (!destination)
  throw new Error("Usage: node scripts/stage-release.mjs <new-directory>");
const target = resolve(destination);
const source = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
if (!source.private || source.version !== "0.0.0-rehearsal.0")
  throw new Error("Rehearsal packaging requires a private rehearsal manifest");
const notices = await generateNotices();
if (notices !== (await readFile(join(root, "THIRD-PARTY-NOTICES"), "utf8")))
  throw new Error("Regenerate third-party notices before packaging");
await mkdir(target);
const required = [
  "README.md",
  "README.zh-CN.md",
  "CONTRIBUTING.md",
  "docs/DEMO.md",
  "docs/RELEASE.md",
  "LICENSE",
  "THIRD-PARTY-NOTICES",
  "SECURITY.md",
  "integrations/skills/tlineage/SKILL.md",
];
for (const path of required) {
  await mkdir(join(target, path, ".."), { recursive: true });
  await copyFile(join(root, path), join(target, path));
}
for (const folder of ["dist", "dist/viewer-assets"]) {
  await mkdir(join(target, folder), { recursive: true });
  for (const entry of await readdir(join(root, folder), {
    withFileTypes: true,
  })) {
    if (entry.isFile() && entry.name.endsWith(".js"))
      await copyFile(
        join(root, folder, entry.name),
        join(target, folder, entry.name),
      );
  }
}
const manifest = {
  name: source.name,
  version: source.version,
  private: true,
  type: source.type,
  license: source.license,
  engines: source.engines,
  bin: source.bin,
  optionalDependencies: source.optionalDependencies,
  repository: source.repository,
  bugs: source.bugs,
  homepage: source.homepage,
  naming: { ...source.naming, distribution: "npm" },
  files: [
    "dist",
    "integrations/skills/tlineage/SKILL.md",
    "README.zh-CN.md",
    "CONTRIBUTING.md",
    "docs/DEMO.md",
    "docs/RELEASE.md",
    "THIRD-PARTY-NOTICES",
    "SECURITY.md",
  ],
};
await writeFile(
  join(target, "package.json"),
  JSON.stringify(manifest, null, 2) + "\n",
);
