import { resolve } from "node:path";
import { locateRepository } from "../../core/src/repositories.js";

type Scope = { cwd?: string; error?: never } | { error: string; cwd?: never };

export function createScope(startup: string, allProjects: boolean) {
  const directory = resolve(startup);
  const initial = locateRepository(directory);
  return async (
    requested: string | undefined,
    preferStartup: boolean,
  ): Promise<Scope> => {
    const current = await initial;
    if (!current && !allProjects)
      return {
        error:
          "TLineage MCP must start in a Git repository for project-scoped access.",
      };
    if (requested !== undefined) {
      const target = await locateRepository(resolve(directory, requested));
      if (!target || (!allProjects && target.repoRoot !== current?.repoRoot))
        return {
          error: "Requested directory is outside the allowed Git repository.",
        };
      return { cwd: target.repoRoot };
    }
    return {
      cwd: allProjects
        ? preferStartup
          ? current?.repoRoot
          : undefined
        : current?.repoRoot,
    };
  };
}
