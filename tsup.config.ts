import { build, defineConfig } from "tsup";

export default defineConfig({
  entry: {
    core: "packages/core/src/index.ts",
    cli: "packages/cli/src/index.ts",
    viewer: "packages/viewer/src/index.ts",
    mcp: "packages/mcp/src/index.ts",
  },
  format: ["esm"],
  platform: "node",
  target: "node20",
  clean: true,
  bundle: true,
  metafile: true,
  noExternal: [/^@modelcontextprotocol\//, /^zod(?:\/|$)/],
  async onSuccess() {
    await build({
      config: false,
      entry: { browser: "packages/viewer/src/browser.ts" },
      outDir: "dist/viewer-assets",
      platform: "browser",
      target: "es2022",
      format: ["iife"],
      minify: true,
      metafile: true,
    });
  },
});
