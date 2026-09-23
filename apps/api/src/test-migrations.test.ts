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
        entries: tags.map((tag, index) => ({ tag, when: (index + 1) * 1_000 })),
      }),
    );
    for (const tag of tags) await writeFile(join(source, `${tag}.sql`), `-- ${tag}\n`);
  });

  afterEach(async () => {
    await rm(source, { recursive: true, force: true });
  });

  it("retains an explicitly declared parallel gap and exposes its full-history cursor consequence", async () => {
    const fixture = await migrationsWithout(
      source,
      "nohmi-history-fixture-",
      ["0001_excluded", "0003_excluded"],
      ["0002_parallel"],
    );
    try {
      expect((await readdir(fixture)).filter((name) => name.endsWith(".sql"))).toEqual([
        "0000_base.sql",
        "0002_parallel.sql",
      ]);
      const journal = JSON.parse(await readFile(join(fixture, "meta/_journal.json"), "utf8")) as {
        entries: Array<{ tag: string; when: number }>;
      };
      expect(journal.entries.map((entry) => entry.tag)).toEqual(["0000_base", "0002_parallel"]);
      const full = JSON.parse(await readFile(join(source, "meta/_journal.json"), "utf8")) as {
        entries: Array<{ tag: string; when: number }>;
      };
      const cursor = journal.entries.at(-1)?.when;
      expect(cursor).toBe(3_000);
      if (cursor === undefined) throw new Error("Fixture journal has no migration cursor");
      // Drizzle's full-history upgrade reads only entries after the applied cursor;
      // this intentionally parallel history skips 0001 and requires reconciliation.
      expect(full.entries.filter((entry) => entry.when > cursor).map((entry) => entry.tag)).toEqual(
        ["0003_excluded", "0004_new"],
      );
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

  it("rejects a retained gap that was not explicitly declared", async () => {
    let fixture: string | undefined;
    try {
      fixture = await migrationsWithout(source, "nohmi-history-unsafe-gap-", [
        "0001_excluded",
        "0003_excluded",
      ]);
      throw new Error("Expected an undeclared-gap error");
    } catch (error) {
      expect((error as Error).message).toContain("Undeclared retained migration: 0002_parallel");
    } finally {
      if (fixture) await rm(fixture, { recursive: true, force: true });
    }
  });

  it("rejects a declared tag that is not the exact retained gap", async () => {
    await expect(
      migrationsWithout(
        source,
        "nohmi-history-wrong-gap-",
        ["0001_excluded", "0003_excluded"],
        ["0004_new"],
      ),
    ).rejects.toThrow("Declared retained migration is not a gap: 0004_new");
  });
});
