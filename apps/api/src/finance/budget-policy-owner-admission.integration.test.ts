import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { createDatabaseClient, type DatabaseClient, migrateDatabase } from "@personal-os/database";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { createFinanceService } from "../finance-service.js";
import { createFinanceBudgetPolicyService } from "./budget-policy-service.js";
import type { FinanceMutationContext } from "./context.js";

// Exercises the existing shared account deletion implementation, not a substitute lock helper.
describe("owner deletion, account deletion, and policy save admission", () => {
  let container: StartedPostgreSqlContainer;
  let database: DatabaseClient;
  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:17.5-alpine").start();
    database = createDatabaseClient({
      connectionString: container.getConnectionUri(),
      options: "-c statement_timeout=4000",
    });
    await migrateDatabase(database.db, resolve(process.cwd(), "packages/database/migrations"));
  }, 120_000);
  afterAll(async () => {
    await database?.close();
    await container?.stop();
  });

  it("settles all three operations without an owner/account lock cycle", async () => {
    const userId = randomUUID(),
      planId = randomUUID(),
      budgetId = randomUUID(),
      accountId = randomUUID();
    const now = () => new Date("2026-09-20T12:00:00Z");
    await database.pool.query(
      "INSERT INTO users(id,email,display_name,password_hash) VALUES($1,$2,'Admission test','unused')",
      [userId, `${userId}@example.test`],
    );
    await database.pool.query(
      "INSERT INTO finance_accounts(id,user_id,provider,institution,name) VALUES($1,$2,'manual','Test','Dependency')",
      [accountId, userId],
    );
    await database.pool.query("INSERT INTO finance_budget_plans(id,user_id) VALUES($1,$2)", [
      planId,
      userId,
    ]);
    await database.pool.query(
      "INSERT INTO finance_budget_versions(id,user_id,plan_id,version,status,effective_from,expected_resources_cents,allocated_total_cents,balance_delta_cents,resources,rationale,approved_by_actor_type,approved_by_actor_id,approved_at) VALUES($1,$2,$3,1,'active','2026-09',100,100,0,$4,'Human baseline','user',$2::uuid::text,now())",
      [budgetId, userId, planId, JSON.stringify([{ key: "income", kind: "income", amount: 100 }])],
    );
    await database.pool.query(
      "INSERT INTO finance_budget_allocations(user_id,budget_version_id,allocation_key,kind,amount_cents) VALUES($1,$2,'buffer','buffer',100)",
      [userId, budgetId],
    );
    const context: FinanceMutationContext = {
      userId,
      actorId: userId,
      actorType: "user",
      canMutate: true,
      canSelfApprove: false,
      bypassEnabled: false,
      requestId: randomUUID(),
    };
    const service = createFinanceBudgetPolicyService({ db: database.db, now });
    const shared = createFinanceService({ db: database.db, now });
    const budget = { id: budgetId, revision: "1" };
    const period = { from: "2026-09-01", through: "2026-09-30", timezone: "UTC" };
    await service.designateBaseline(context, {
      idempotencyKey: randomUUID(),
      planId,
      period,
      budget,
      expectedProfile: null,
      expectedLatestBudget: budget,
    });
    const policy = await service.createPolicy(context, {
      idempotencyKey: randomUUID(),
      planId,
      expectedProfile: null,
      expectedLatestBudget: budget,
      terms: {
        currency: "USD",
        period,
        rollover: "none",
        accounting: "gross_positive_allocation_deltas",
        usageScope: "user_month_all_policy_versions",
        perChangeCapCents: 100,
        monthlyCapCents: 100,
        expiresAt: "2026-10-01T00:00:00Z",
        baseline: budget,
        directions: [],
        protections: [],
      },
    });
    const expected = {
      userId,
      planId,
      policy: { id: policy.latestVersion.id, revision: "1" },
      policyLifecycleRevision: 1,
      profile: null,
      baseline: budget,
      activeBudget: budget,
      latestBudget: budget,
      positionRevision: null,
      usageRevision: null,
    };
    const candidate = {
      userId,
      planId,
      revision: { id: randomUUID(), revision: "1" },
      month: "2026-09",
      resources: [{ key: "income", kind: "income", sourceId: null, amountCents: 100 }],
      allocations: [{ key: "debt", kind: "debt", targetId: accountId, amountCents: 100 }],
    };
    const proposal = await service.createProposal(context, {
      idempotencyKey: randomUUID(),
      policyId: policy.id,
      expected,
      candidate,
    });
    const gate = await database.pool.connect();
    const ownerDeletion = await database.pool.connect();
    const trace: unknown[] = [];
    const pending: Promise<unknown>[] = [];
    const record = async (label: string, operation: Promise<unknown>) => {
      try {
        await operation;
        const result = { label, status: "completed" };
        trace.push(result);
        return result;
      } catch (error) {
        const e = error as { code?: string; cause?: { code?: string }; message: string };
        const result = {
          label,
          status: "rejected",
          code: e.code ?? e.cause?.code,
          message: e.message,
        };
        trace.push(result);
        return result;
      }
    };
    async function waitFor(label: string, pattern: string, event: string) {
      let rows: unknown[] = [];
      await expect
        .poll(
          async () => {
            rows = (
              await database.pool.query(
                "SELECT pid,wait_event_type,wait_event,pg_blocking_pids(pid) AS blockers,query FROM pg_stat_activity WHERE datname=current_database() AND wait_event=$1 AND query LIKE $2",
                [event, pattern],
              )
            ).rows;
            return rows.length;
          },
          { timeout: 2_000, interval: 10 },
        )
        .toBe(1);
      trace.push({ stage: label, waiters: rows });
    }
    try {
      // A test-only table gate pauses the real account transaction at its final audit INSERT.
      await gate.query("BEGIN");
      await gate.query("LOCK TABLE audit_events IN SHARE MODE");
      const deleting = record(
        "account deletion",
        shared.deleteAccount(accountId, {
          principal: {
            userId,
            actorId: userId,
            actorType: "user",
            scopes: new Set(["finances:read", "finances:write"]),
          },
          requestId: randomUUID(),
        }),
      );
      pending.push(deleting);
      await waitFor(
        "account deletion holds dependency before audit",
        'insert into "audit_events"%',
        "relation",
      );
      const saving = record(
        "policy save",
        service.savePreview(context, proposal.id, {
          idempotencyKey: randomUUID(),
          expected,
          expectedProposalRevision: 1,
          expiresAt: "2026-09-21T00:00:00Z",
        }),
      );
      pending.push(saving);
      await waitFor(
        "policy save holds owner admission and waits on account",
        '%from "finance_accounts"%for key share%',
        "transactionid",
      );
      await ownerDeletion.query("BEGIN");
      const deletingOwner = record(
        "owner deletion",
        (async () => {
          await ownerDeletion.query("DELETE FROM users WHERE id=$1", [userId]);
          await ownerDeletion.query("COMMIT");
        })(),
      );
      pending.push(deletingOwner);
      await waitFor(
        "owner deletion waits on policy admission",
        "DELETE FROM users%",
        "transactionid",
      );
      // Let the real account implementation acquire its audit FK lock and commit normally.
      await gate.query("COMMIT");
      const outcomes = await Promise.all([deleting, saving, deletingOwner]);
      console.info("owner/account/policy lock chronology", JSON.stringify(trace));
      expect(outcomes).toEqual([
        { label: "account deletion", status: "completed" },
        expect.objectContaining({
          label: "policy save",
          status: "rejected",
          code: "invalid_request",
        }),
        { label: "owner deletion", status: "completed" },
      ]);
      expect(
        (
          await database.pool.query(
            "SELECT count(*)::int AS n FROM finance_budget_policy_previews WHERE user_id=$1",
            [userId],
          )
        ).rows[0].n,
      ).toBe(0);
    } finally {
      await gate.query("ROLLBACK");
      await Promise.all(pending);
      await ownerDeletion.query("ROLLBACK");
      gate.release();
      ownerDeletion.release();
    }
  }, 15_000);
});
