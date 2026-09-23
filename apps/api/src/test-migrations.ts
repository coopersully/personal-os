import { cp, mkdtemp, readFile, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export async function migrationsWithout(
  migrationsFolder: string,
  prefix: string,
  excludedTags: string[],
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
  const latestExcluded = journal.entries.findLastIndex((entry) => excludedTags.includes(entry.tag));
  const excluded = new Set(excludedTags);
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
