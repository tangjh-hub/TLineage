import { NAMING, PRODUCT_NAME } from "../../core/src/index.js";
import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { createTools, toolDefinitions, type ToolOptions } from "./tools.js";

export function serveTLineageMcp(options: ToolOptions = {}) {
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.stdin.once("end", stop);
  const call = createTools({
    ...options,
    prewarm: true,
    signal: controller.signal,
  });
  const service = serveStdio(
    () => {
      const server = new McpServer(
        { name: NAMING.mcpService, version: "0.0.0" },
        { capabilities: { tools: {} } },
      );
      server.server.setRequestHandler("tools/list", () => ({
        tools: toolDefinitions,
      }));
      server.server.setRequestHandler("tools/call", ({ params }) =>
        call(params.name, params.arguments),
      );
      return server;
    },
    {
      legacy: "serve",
      onerror: () =>
        process.stderr.write(`${PRODUCT_NAME} MCP transport error.\n`),
    },
  );
  return {
    close: async () => {
      process.stdin.off("end", stop);
      stop();
      await service.close();
    },
  };
}
