import { cp, mkdtemp, readFile, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export async function migrationsWithout(
  migrationsFolder: string,
  prefix: string,
  excludedTags: string[],
): Promise<string> {
  const folder = await mkdtemp(join(tmpdir(), prefix));
  await cp(migrationsFolder, folder, { recursive: true });
  for (const tag of excludedTags) {
    await unlink(join(folder, `${tag}.sql`));
  }
  const journalPath = join(folder, "meta/_journal.json");
  const journal = JSON.parse(await readFile(journalPath, "utf8")) as {
    entries: Array<{ tag: string }>;
  };
  journal.entries = journal.entries.filter((entry) => !excludedTags.includes(entry.tag));
  await writeFile(journalPath, `${JSON.stringify(journal, null, 2)}\n`);
  return folder;
}
