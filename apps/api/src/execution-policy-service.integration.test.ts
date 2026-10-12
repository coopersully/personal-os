import { resolve } from "node:path";
import {
  auditEvents,
  createDatabaseClient,
  type DatabaseClient,
  migrateDatabase,
  users,
} from "@personal-os/database";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { eq } from "drizzle-orm";
import { createExecutionPolicyService } from "./execution-policy-service.js";
import type { Principal } from "./types.js";

describe.sequential("exact revision review policy saves", () => {
  let container: StartedPostgreSqlContainer;
  let database: DatabaseClient;
  let service: ReturnType<typeof createExecutionPolicyService>;
  const owner = crypto.randomUUID();
  const other = crypto.randomUUID();
  const principal: Principal = {
    userId: owner,
    actorId: owner,
    actorType: "user",
    scopes: new Set(),
  };
  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:17.5-alpine").start();
    database = createDatabaseClient(container.getConnectionUri());
    await migrateDatabase(database.db, resolve(process.cwd(), "packages/database/migrations"));
    await database.db.insert(users).values(
      [owner, other].map((id) => ({
        id,
        email: `${id}@example.com`,
        displayName: "Policy fixture",
        passwordHash: "unused",
      })),
    );
    service = createExecutionPolicyService({
      db: database.db,
      now: () => new Date("2026-10-08T12:00:00Z"),
    });
  }, 120_000);
  afterAll(async () => {
    await database?.close();
    await container?.stop();
  });
  it("keeps default and unchanged saves audit-free, permits one concurrent winner and isolates owners", async () => {
    const context = { principal, requestId: "review-policy-save" };
    expect(await service.get(owner)).toEqual({ reviewBypassEnabled: false, version: 1 });
    expect(
      await service.update({ expectedVersion: 1, reviewBypassEnabled: false }, context),
    ).toEqual({ reviewBypassEnabled: false, version: 1 });
    expect(await database.db.select().from(auditEvents)).toHaveLength(0);
    const results = await Promise.allSettled([
      service.update({ expectedVersion: 1, reviewBypassEnabled: true }, context),
      service.update({ expectedVersion: 1, reviewBypassEnabled: true }, context),
    ]);
    expect(results.filter((row) => row.status === "fulfilled")).toHaveLength(1);
    expect(results.find((row) => row.status === "rejected")).toMatchObject({
      reason: { code: "conflict" },
    });
    expect(await service.get(other)).toEqual({ reviewBypassEnabled: false, version: 1 });
    const events = await database.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.userId, owner));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      actorId: owner,
      actorType: "user",
      requestId: "review-policy-save",
      before: { reviewBypassEnabled: false, version: 1 },
      after: { reviewBypassEnabled: true, version: 2 },
    });
    await service.update({ expectedVersion: 2, reviewBypassEnabled: true }, context);
    expect(await database.db.select().from(auditEvents)).toHaveLength(1);
    await expect(
      service.update(
        { expectedVersion: 2, reviewBypassEnabled: false },
        { ...context, principal: { ...principal, actorType: "agent" } },
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(await service.get(owner)).toEqual({ reviewBypassEnabled: true, version: 2 });
    expect(await database.db.select().from(auditEvents)).toHaveLength(1);
    await service.update(
      { expectedVersion: 1, reviewBypassEnabled: true },
      {
        principal: { ...principal, userId: other, actorId: other },
        requestId: "other-policy-save",
      },
    );
    expect(await service.get(other)).toEqual({ reviewBypassEnabled: true, version: 2 });
  });
});
