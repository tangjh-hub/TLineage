import { readFile, readdir, writeFile } from "node:fs/promises";
import { isBuiltin } from "node:module";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const readJson = async (file) => JSON.parse(await readFile(file, "utf8"));
const metadata = (path) => readJson(join(root, "dist", path));

export async function generateNotices() {
  const manifest = await readJson(join(root, "package.json"));
  const builds = await Promise.all([
    metadata("metafile-esm.json"),
    metadata("viewer-assets/metafile-iife.json"),
  ]);
  const embedded = new Map();
  for (const { outputs } of builds) {
    for (const output of Object.values(outputs)) {
      for (const item of output.imports ?? []) {
        if (item.external && !isBuiltin(item.path))
          throw new Error("Unreviewed external module: " + item.path);
      }
      for (const [input, { bytesInOutput }] of Object.entries(output.inputs)) {
        if (!bytesInOutput) continue;
        const file = resolve(root, input);
        if (!file.split(sep).includes("node_modules")) {
          if (
            file !== join(root, "package.json") &&
            !file.startsWith(join(root, "packages") + sep)
          )
            throw new Error("Unreviewed bundled source: " + input);
          continue;
        }
        let directory = dirname(file);
        for (;;) {
          const parent = dirname(directory);
          if (
            parent === directory ||
            !directory.split(sep).includes("node_modules")
          )
            throw new Error("Unattributed bundled module: " + input);
          const pkg = await readJson(join(directory, "package.json")).catch(
            (error) => {
              if (error.code === "ENOENT") return;
              throw error;
            },
          );
          if (pkg?.name && pkg.version && pkg.license) {
            embedded.set(pkg.name + "@" + pkg.version, { pkg, directory });
            break;
          }
          directory = parent;
        }
      }
    }
  }
  const optional = new Map();
  for (const [name, version] of Object.entries(
    manifest.optionalDependencies ?? {},
  )) {
    const directory = join(root, "node_modules", name);
    const pkg = await readJson(join(directory, "package.json"));
    if (pkg.version !== version)
      throw new Error("Optional dependency version mismatch: " + name);
    optional.set(name + "@" + version, { pkg, directory });
  }
  const lines = ["THIRD-PARTY NOTICES", ""];
  for (const [heading, entries] of [
    ["Bundled in the distributed JavaScript", embedded],
    ["Optional runtime dependencies installed separately", optional],
  ]) {
    lines.push(heading, "");
    for (const [key, { pkg, directory }] of [...entries.entries()].sort(
      ([a], [b]) => a.localeCompare(b, "en"),
    )) {
      const names = (await readdir(directory))
        .filter((name) =>
          /^(?:licen[cs]e|notice|copying)(?:[.-].*)?$/i.test(name),
        )
        .sort();
      if (!names.some((name) => /^(?:licen[cs]e|copying)/i.test(name)))
        throw new Error("Missing license text: " + key);
      lines.push(key + " — " + pkg.license, "");
      for (const name of names) {
        const text = await readFile(join(directory, name), "utf8");
        if (!text.trim()) throw new Error("Empty license or notice: " + key);
        lines.push(name, text.trimEnd(), "");
      }
    }
  }
  return lines.join("\n");
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const path = join(root, "THIRD-PARTY-NOTICES");
  const generated = await generateNotices();
  if (process.argv.includes("--check")) {
    if ((await readFile(path, "utf8")) !== generated)
      throw new Error("Third-party notices are stale");
  } else await writeFile(path, generated);
}
