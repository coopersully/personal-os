import { cp, mkdtemp, readFile, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export async function migrationsWithout(
  migrationsFolder: string,
  prefix: string,
  excludedTags: string[],
  allowedRetainedGapTags: readonly string[] = [],
): Promise<string> {
  if (excludedTags.length === 0) throw new Error("At least one migration tag must be excluded");
  const journal = JSON.parse(
    await readFile(join(migrationsFolder, "meta/_journal.json"), "utf8"),
  ) as {
    entries: Array<{ tag: string }>;
  };
  const knownTags = new Set(journal.entries.map((entry) => entry.tag));
  for (const tag of excludedTags) {
    if (!knownTags.has(tag)) throw new Error(`Unknown excluded migration tag: ${tag}`);
  }
  // A historical fixture cannot include migrations published after its latest
  // excluded migration: they would advance Drizzle's cursor past that gap.
  // Retained migrations between exclusions are intentional parallel histories;
  // callers must name each one because a later cursor can skip an excluded peer.
  const firstExcluded = journal.entries.findIndex((entry) => excludedTags.includes(entry.tag));
  const latestExcluded = journal.entries.findLastIndex((entry) => excludedTags.includes(entry.tag));
  const excluded = new Set(excludedTags);
  const retainedGap = journal.entries
    .slice(firstExcluded + 1, latestExcluded)
    .filter((entry) => !excluded.has(entry.tag))
    .map((entry) => entry.tag);
  const retainedGapTags = new Set(retainedGap);
  for (const tag of allowedRetainedGapTags) {
    if (!retainedGapTags.has(tag))
      throw new Error(`Declared retained migration is not a gap: ${tag}`);
  }
  const allowed = new Set(allowedRetainedGapTags);
  for (const tag of retainedGap) {
    if (!allowed.has(tag)) throw new Error(`Undeclared retained migration: ${tag}`);
  }
  const removed = journal.entries.slice(latestExcluded + 1).map((entry) => entry.tag);
  const folder = await mkdtemp(join(tmpdir(), prefix));
  await cp(migrationsFolder, folder, { recursive: true });
  for (const tag of new Set([...excludedTags, ...removed])) {
    await unlink(join(folder, `${tag}.sql`));
  }
  journal.entries = journal.entries
    .slice(0, latestExcluded + 1)
    .filter((entry) => !excluded.has(entry.tag));
  await writeFile(join(folder, "meta/_journal.json"), `${JSON.stringify(journal, null, 2)}\n`);
  return folder;
}
