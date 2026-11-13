import { locateRepository, repositoryKey } from "./repositories.js";
import type { Session, SessionFileRef } from "./types.js";
import { sameFile } from "./fork.js";

type Identity = Pick<Session, "id" | "cwd" | "parents">;

export async function selectSessionFiles(
  files: readonly SessionFileRef[],
  repoRoot: string,
  header: (file: SessionFileRef) => Promise<Identity | undefined>,
  fallback: (file: SessionFileRef) => Promise<Identity | undefined>,
  signal?: AbortSignal,
) {
  const candidates = new Map<
    string,
    { file: SessionFileRef; identity: Identity }[]
  >();
  const needed = new Set<string>();
  const selected = new Set<SessionFileRef>();
  const locations = new Map<string, ReturnType<typeof locateRepository>>();
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(12, files.length) }, async () => {
      while (next < files.length) {
        signal?.throwIfAborted();
        const file = files[next++];
        const hint = await header(file);
        const identity =
          hint && (await sameFile(file)) ? hint : await fallback(file);
        if (!identity) {
          selected.add(file);
          continue;
        }
        const list = candidates.get(identity.id) ?? [];
        list.push({ file, identity });
        candidates.set(identity.id, list);
        let location = locations.get(identity.cwd);
        if (!location) {
          location = locateRepository(identity.cwd);
          locations.set(identity.cwd, location);
        }
        if (
          repositoryKey({ cwd: identity.cwd, ...(await location) }) === repoRoot
        )
          needed.add(identity.id);
      }
    }),
  );
  for (const id of needed) {
    for (const { file, identity } of candidates.get(id) ?? []) {
      selected.add(file);
      for (const parent of identity.parents) needed.add(parent.sessionId);
    }
  }
  return files.filter((file) => selected.has(file));
}
