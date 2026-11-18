import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import {
  auditEvents,
  createDatabaseClient,
  type DatabaseClient,
  financeAccounts,
  migrateDatabase,
  users,
} from "@personal-os/database";
import { createFinanceAccountInputSchema } from "@personal-os/domain";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createFinanceService } from "./finance-service.js";

describe.sequential("manual account currency through the canonical writer", () => {
  let database: DatabaseClient;
  let container: StartedPostgreSqlContainer;
  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:17.5-alpine").start();
    database = createDatabaseClient(container.getConnectionUri());
    await migrateDatabase(database.db, resolve(process.cwd(), "packages/database/migrations"));
  }, 120_000);
  afterAll(async () => {
    await database?.close();
    await container?.stop();
  });
  it.each([
    "USD",
    "EUR",
    null,
    undefined,
  ])("persists, returns and audits explicit currency %s without inference", async (currencyCode) => {
    const [owner] = await database.db
      .insert(users)
      .values({
        email: `qa+manual-currency-${randomUUID()}@nohmi.test`,
        displayName: "Disposable currency owner",
        passwordHash: "unused",
      })
      .returning();
    if (!owner) throw new Error("Missing owner");
    const service = createFinanceService({
      db: database.db,
      now: () => new Date("2026-10-18T12:00:00Z"),
    });
    const input = createFinanceAccountInputSchema.parse({
      name: "Travel cash",
      institution: "Personal records",
      balance: 20,
      ...(currencyCode === undefined ? {} : { currencyCode }),
    });
    const created = await service.createAccount(input, {
      principal: {
        userId: owner.id,
        actorId: owner.id,
        actorType: "user",
        scopes: new Set(["finances:read", "finances:write"]),
      },
      requestId: randomUUID(),
    });
    expect(created.currencyCode).toBe(currencyCode ?? null);
    const [stored] = await database.db
      .select()
      .from(financeAccounts)
      .where(eq(financeAccounts.id, created.id));
    expect(stored?.currencyCode).toBe(currencyCode ?? null);
    const reread = await service.listFinanceAccounts(owner.id, { includeExcluded: false });
    expect(reread.accounts.find((account) => account.id === created.id)?.currencyCode).toBe(
      currencyCode ?? null,
    );
    const [audit] = await database.db
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.userId, owner.id),
          eq(auditEvents.entityId, created.id),
          eq(auditEvents.action, "finance.account_created"),
        ),
      );
    expect(audit?.after).toMatchObject({ currencyCode: currencyCode ?? null });
  });
});
