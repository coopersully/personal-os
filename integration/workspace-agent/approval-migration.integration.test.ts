import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  createDatabaseClient,
  type DatabaseClient,
  domainProfileApprovals,
  migrateDatabase,
} from "@personal-os/database";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";

describe("approval provenance migration", () => {
  let container: StartedPostgreSqlContainer;
  let database: DatabaseClient;
  let folder: string;
  afterAll(async () => {
    await database?.close();
    await container?.stop();
    if (folder) await rm(folder, { recursive: true, force: true });
  });
  it("preserves old owner approvals and rejects mixed or missing actor attribution", async () => {
    container = await new PostgreSqlContainer("postgres:17.5-alpine").start();
    database = createDatabaseClient(container.getConnectionUri());
    folder = await mkdtemp(join(tmpdir(), "nohmi-approval-migration-"));
    await mkdir(join(folder, "meta"));
    const migrationRoot = resolve("packages/database/migrations");
    const journal = JSON.parse(await readFile(join(migrationRoot, "meta/_journal.json"), "utf8"));
    const approvalMigrationIndex = journal.entries.findIndex(
      (entry: { tag: string }) => entry.tag === "0110_workspace_agent_approval_provenance",
    );
    expect(approvalMigrationIndex).toBeGreaterThan(0);
    journal.entries = journal.entries.slice(0, approvalMigrationIndex);
    for (const entry of journal.entries)
      await copyFile(join(migrationRoot, `${entry.tag}.sql`), join(folder, `${entry.tag}.sql`));
    await writeFile(join(folder, "meta/_journal.json"), JSON.stringify(journal));
    await migrateDatabase(database.db, folder);
    const ownerId = crypto.randomUUID(),
      profileId = crypto.randomUUID();
    await database.pool.query(
      "INSERT INTO users(id,email,display_name,password_hash) VALUES($1,'migration@example.com','Migration','unused')",
      [ownerId],
    );
    await database.pool.query(
      "INSERT INTO domain_profiles(id,user_id,domain,objective,summary,status) VALUES($1,$2,'finances','Preserve','Old approval','active')",
      [profileId, ownerId],
    );
    const profile = { id: profileId, domain: "finances", version: 1, status: "active" };
    await database.pool.query(
      "INSERT INTO domain_profile_approvals(user_id,domain,profile_id,profile_version,profile,approved_by_user_id,approved_at) VALUES($1,'finances',$2,1,$3,$1,'2026-10-01T00:00:00Z')",
      [ownerId, profileId, profile],
    );
    await migrateDatabase(database.db, migrationRoot);
    const [approval] = await database.db.select().from(domainProfileApprovals);
    expect(approval).toMatchObject({
      approvalSource: "user_instruction",
      approvedByUserId: ownerId,
      approvedByAgentId: null,
      profile,
    });
    await expect(
      database.pool.query(
        "UPDATE domain_profile_approvals SET approval_source='agent_self_approval',approved_by_agent_id='fixture-agent' WHERE user_id=$1",
        [ownerId],
      ),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      database.pool.query(
        "UPDATE domain_profile_approvals SET approved_by_user_id=NULL WHERE user_id=$1",
        [ownerId],
      ),
    ).rejects.toMatchObject({ code: "23514" });
    await database.pool.query(
      "UPDATE domain_profile_approvals SET approval_source='agent_self_approval',approved_by_user_id=NULL,approved_by_agent_id='fixture-agent' WHERE user_id=$1",
      [ownerId],
    );
    expect((await database.db.select().from(domainProfileApprovals))[0]).toMatchObject({
      approvalSource: "agent_self_approval",
      approvedByUserId: null,
      approvedByAgentId: "fixture-agent",
      profile,
    });
  }, 120_000);
});
