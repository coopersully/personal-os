import { resolve } from "node:path";
import {
  createDatabaseClient,
  financeAgentActionReviews,
  financeAutomationSettings,
  migrateDatabase,
  users,
} from "@personal-os/database";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { eq } from "drizzle-orm";
import { createFinanceActionService } from "./finance-action-service.js";
import type { Principal } from "./types.js";

const now = new Date("2026-08-17T12:00:00.000Z");

function agent(userId: string): Principal {
  return {
    actorId: "finance-agent",
    actorType: "agent",
    scopes: new Set(["finances:read", "finances:write"]),
    userId,
  };
}

function user(userId: string): Principal {
  return {
    actorId: userId,
    actorType: "user",
    scopes: new Set(["finances:read", "finances:write"]),
    userId,
  };
}

describe.sequential("finance action service", () => {
  let container: StartedPostgreSqlContainer;
  let database: ReturnType<typeof createDatabaseClient>;
  let userId: string;

  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:17.5-alpine")
      .withDatabase("personal_os")
      .withUsername("personal_os")
      .withPassword("personal_os")
      .start();
    database = createDatabaseClient(container.getConnectionUri());
    await migrateDatabase(database.db, resolve(process.cwd(), "packages/database/migrations"));
    const [user] = await database.db
      .insert(users)
      .values({
        displayName: "Finance actions",
        email: "finance-actions@example.com",
        passwordHash: "unused",
        planningTimezone: "UTC",
      })
      .returning();
    if (!user) throw new Error("Finance action test user was not created.");
    userId = user.id;
  });

  afterAll(async () => {
    await database.close();
    await container.stop();
  });

  it("queues prepared agent work when durable bypass is disabled, then applies the same action after it is enabled", async () => {
    // A regression that applies before queueing would make the first assertion fail.
    await database.db
      .insert(financeAutomationSettings)
      .values({ reviewBypassEnabled: false, userId })
      .onConflictDoUpdate({
        set: { reviewBypassEnabled: false, updatedAt: now },
        target: financeAutomationSettings.userId,
      });
    const updateProfile = vi.fn(async () => ({ id: "profile-1", updatedAt: now.toISOString() }));
    const service = createFinanceActionService({
      db: database.db,
      finances: { updateProfile } as never,
      now: () => now,
    });
    const context = { principal: agent(userId), requestId: "action-queue" };
    const input = { effectiveDate: "2026-08-17", employer: "Ilo", payFrequency: "monthly" };

    await expect(service.performDirect("profile", input, context)).resolves.toMatchObject({
      status: "pending_review",
      review: { actionKind: "profile", status: "pending" },
    });
    expect(updateProfile).not.toHaveBeenCalled();
    await expect(
      database.db
        .select({ status: financeAgentActionReviews.status })
        .from(financeAgentActionReviews)
        .where(eq(financeAgentActionReviews.userId, userId)),
    ).resolves.toEqual([{ status: "pending" }]);

    await database.db
      .update(financeAutomationSettings)
      .set({ reviewBypassEnabled: true, updatedAt: now })
      .where(eq(financeAutomationSettings.userId, userId));
    await expect(service.performDirect("profile", input, context)).resolves.toMatchObject({
      result: { id: "profile-1" },
      status: "applied",
    });
    expect(updateProfile).toHaveBeenCalledOnce();
  });

  it("returns a question before consulting bypass when a categorization lacks evidence", async () => {
    // A regression that uses bypass as permission to invent a category would apply this action.
    const getAutomationSettings = vi.fn();
    const service = createFinanceActionService({
      db: database.db,
      finances: { getAutomationSettings } as never,
      now: () => now,
    });

    await expect(
      service.performDirect(
        "categorization",
        { decisions: [] },
        {
          principal: agent(userId),
          requestId: "missing-evidence",
        },
      ),
    ).resolves.toMatchObject({
      question: { actionKind: "categorization" },
      status: "needs_input",
    });
    expect(getAutomationSettings).not.toHaveBeenCalled();
  });

  it("locks a pending review so repeated human approval applies its prepared action once", async () => {
    // A regression that replays an applied review would call updateProfile twice.
    await database.db
      .update(financeAutomationSettings)
      .set({ reviewBypassEnabled: false, updatedAt: now })
      .where(eq(financeAutomationSettings.userId, userId));
    const updateProfile = vi.fn(async () => ({ id: "profile-approved" }));
    const service = createFinanceActionService({
      db: database.db,
      finances: { updateProfile } as never,
      now: () => now,
    });
    const input = {
      effectiveDate: "2026-08-18",
      employer: "Ilo",
      payFrequency: "monthly",
    };
    const queued = await service.performDirect("profile", input, {
      principal: agent(userId),
      requestId: "approval-queue",
    });
    if (queued.status !== "pending_review") throw new Error("Expected a pending Finance review.");
    const approvalContext = { principal: user(userId), requestId: "approval" };

    await expect(service.approve(queued.review.id, approvalContext)).resolves.toMatchObject({
      result: { id: "profile-approved" },
      status: "applied",
    });
    await expect(service.approve(queued.review.id, approvalContext)).resolves.toMatchObject({
      result: { id: "profile-approved" },
      status: "applied",
    });
    expect(updateProfile).toHaveBeenCalledOnce();
  });
});
