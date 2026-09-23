import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrationsWithout } from "./test-migrations.js";

describe("historical migration fixtures", () => {
  let source: string;
  const tags = ["0000_base", "0001_excluded", "0002_parallel", "0003_excluded", "0004_new"];

  beforeEach(async () => {
    source = await mkdtemp(join(tmpdir(), "nohmi-history-source-"));
    await mkdir(join(source, "meta"));
    await writeFile(
      join(source, "meta/_journal.json"),
      JSON.stringify({
        version: "7",
        dialect: "postgresql",
        entries: tags.map((tag) => ({ tag })),
      }),
    );
    for (const tag of tags) await writeFile(join(source, `${tag}.sql`), `-- ${tag}\n`);
  });

  afterEach(async () => {
    await rm(source, { recursive: true, force: true });
  });

  it("retains included earlier migrations but excludes the tail after the latest gap", async () => {
    const fixture = await migrationsWithout(source, "nohmi-history-fixture-", [
      "0001_excluded",
      "0003_excluded",
    ]);
    try {
      expect((await readdir(fixture)).filter((name) => name.endsWith(".sql"))).toEqual([
        "0000_base.sql",
        "0002_parallel.sql",
      ]);
      const journal = JSON.parse(await readFile(join(fixture, "meta/_journal.json"), "utf8")) as {
        entries: Array<{ tag: string }>;
      };
      expect(journal.entries.map((entry) => entry.tag)).toEqual(["0000_base", "0002_parallel"]);
    } finally {
      await rm(fixture, { recursive: true, force: true });
    }
  });

  it("rejects empty and unknown exclusions instead of silently removing the history", async () => {
    await expect(migrationsWithout(source, "nohmi-history-empty-", [])).rejects.toThrow(
      "At least one migration tag must be excluded",
    );
    await expect(migrationsWithout(source, "nohmi-history-unknown-", ["missing"])).rejects.toThrow(
      "Unknown excluded migration tag: missing",
    );
  });
});
