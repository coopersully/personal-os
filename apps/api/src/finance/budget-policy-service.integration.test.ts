import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { createDatabaseClient, type DatabaseClient, migrateDatabase } from "@personal-os/database";
import * as databaseSchema from "@personal-os/database/schema";
import {
  financeBudgetPolicyEvaluationInputSchema,
  financeBudgetPolicyEvaluationSchema,
  financeBudgetPolicyPlanSnapshotSchema,
  financeBudgetPolicyTermsSchema,
  financeBudgetResourceSchema,
} from "@personal-os/domain";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { drizzle } from "drizzle-orm/node-postgres";
import { createFinanceBudgetPolicyService } from "./budget-policy-service.js";
import type { FinanceMutationContext } from "./context.js";

describe.sequential("human budget policy management", () => {
  let container: StartedPostgreSqlContainer;
  let database: DatabaseClient;
  let service: ReturnType<typeof createFinanceBudgetPolicyService>;
  let clock = new Date("2026-09-20T12:00:00Z");
  const period = { from: "2026-09-01", through: "2026-09-30", timezone: "America/New_York" };
  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:17.5-alpine").start();
    database = createDatabaseClient(container.getConnectionUri());
    await migrateDatabase(database.db, resolve(process.cwd(), "packages/database/migrations"));
    service = createFinanceBudgetPolicyService({ db: database.db, now: () => clock });
  }, 120_000);
  afterAll(async () => {
    await database?.close();
    await container?.stop();
  });
  beforeEach(() => {
    clock = new Date("2026-09-20T12:00:00Z");
  });
  async function fixture() {
    const userId = randomUUID(),
      planId = randomUUID(),
      budgetId = randomUUID(),
      profileId = randomUUID();
    await database.pool.query(
      "INSERT INTO users(id,email,display_name,password_hash) VALUES($1,$2,'Policy','unused')",
      [userId, `${userId}@example.test`],
    );
    await database.pool.query(
      "INSERT INTO finance_profile_versions(id,user_id,version) VALUES($1,$2,1)",
      [profileId, userId],
    );
    await database.pool.query("INSERT INTO finance_budget_plans(id,user_id) VALUES($1,$2)", [
      planId,
      userId,
    ]);
    await database.pool.query(
      "INSERT INTO finance_budget_versions(id,user_id,plan_id,profile_version_id,version,status,effective_from,expected_resources_cents,allocated_total_cents,balance_delta_cents,resources,rationale,approved_by_actor_type,approved_by_actor_id,approved_at) VALUES($1,$2,$3,$4,1,'active','2026-09',10000,10000,0,$5,'Human plan','user',$2::uuid::text,now())",
      [
        budgetId,
        userId,
        planId,
        profileId,
        JSON.stringify([{ key: "income", kind: "income", amount: 10000 }]),
      ],
    );
    for (const [key, amount] of [
      ["spending", 6000],
      ["buffer", 4000],
    ])
      await database.pool.query(
        "INSERT INTO finance_budget_allocations(user_id,budget_version_id,allocation_key,kind,amount_cents) VALUES($1,$2,$3,$3,$4)",
        [userId, budgetId, key, amount],
      );
    const context: FinanceMutationContext = {
      userId,
      actorId: userId,
      actorType: "user",
      bypassEnabled: true,
      canMutate: true,
      canSelfApprove: false,
      requestId: randomUUID(),
    };
    const budget = { id: budgetId, revision: "1" },
      profile = { id: profileId, revision: "1" };
    const terms = {
      currency: "USD" as const,
      period,
      rollover: "none" as const,
      accounting: "gross_positive_allocation_deltas" as const,
      usageScope: "user_month_all_policy_versions" as const,
      perChangeCapCents: 1000,
      monthlyCapCents: 2000,
      expiresAt: "2026-10-01T04:00:00Z",
      baseline: budget,
      directions: [
        { allocationKey: "spending", direction: "both" as const },
        { allocationKey: "buffer", direction: "both" as const },
      ],
      protections: [],
    };
    const policyInput = {
      idempotencyKey: randomUUID(),
      planId,
      terms,
      expectedProfile: profile,
      expectedLatestBudget: budget,
    };
    const baselineInput = {
      idempotencyKey: randomUUID(),
      planId,
      period,
      budget,
      expectedProfile: profile,
      expectedLatestBudget: budget,
    };
    const candidate = {
      userId,
      planId,
      revision: { id: randomUUID(), revision: "1" },
      month: "2026-09",
      resources: [{ key: "income", kind: "income" as const, sourceId: null, amountCents: 10000 }],
      allocations: [
        { key: "spending", kind: "spending" as const, targetId: null, amountCents: 6500 },
        { key: "buffer", kind: "buffer" as const, targetId: null, amountCents: 3500 },
      ],
    };
    async function ready() {
      await service.designateBaseline(context, baselineInput);
      const policy = await service.createPolicy(context, policyInput);
      const expected = {
        userId,
        planId,
        policy: { id: policy.latestVersion.id, revision: "1" },
        policyLifecycleRevision: 1,
        profile,
        baseline: budget,
        activeBudget: budget,
        latestBudget: budget,
        positionRevision: null,
        usageRevision: null,
      };
      return { policy, expected };
    }
    return {
      context,
      userId,
      planId,
      budgetId,
      profileId,
      budget,
      profile,
      terms,
      policyInput,
      baselineInput,
      candidate,
      ready,
    };
  }
  it("stores only explicit drafts, replays one receipt and appends immutable terms", async () => {
    const f = await fixture();
    const { policy } = await f.ready();
    expect(policy).toMatchObject({
      state: "draft",
      executionAvailable: false,
      lifecycleRevision: 1,
    });
    expect(await service.createPolicy(f.context, f.policyInput)).toEqual(policy);
    const revised = await service.revisePolicy(f.context, policy.id, {
      idempotencyKey: randomUUID(),
      terms: { ...f.terms, monthlyCapCents: 3000 },
      expectedProfile: f.profile,
      expectedLatestBudget: f.budget,
      expectedLifecycleRevision: 1,
      expectedLatestVersion: 1,
    });
    expect(revised.latestVersion.version).toBe(2);
    expect(
      (
        await database.pool.query(
          "SELECT monthly_cap_cents FROM finance_budget_policy_versions WHERE policy_id=$1 ORDER BY version",
          [policy.id],
        )
      ).rows,
    ).toEqual([{ monthly_cap_cents: 2000 }, { monthly_cap_cents: 3000 }]);
    expect((await service.getPolicy(f.userId, policy.id)).latestVersion.version).toBe(2);
    expect(await service.listPolicies(f.userId, { limit: 1 })).toHaveLength(1);
    await expect(
      service.createPolicy(f.context, {
        ...f.policyInput,
        terms: { ...f.terms, monthlyCapCents: 9999 },
      }),
    ).rejects.toMatchObject({ code: "invalid_request" });
  });
  it("keeps server unavailable evidence honest and saves immutable denied history", async () => {
    const f = await fixture();
    const { policy, expected } = await f.ready();
    const result = await service.previewPolicy(f.userId, {
      policyId: policy.id,
      expected,
      candidate: f.candidate,
    });
    expect(result).toMatchObject({
      kind: "denied",
      executionAvailable: false,
      input: { position: { state: "unavailable" }, usage: { state: "unavailable" } },
    });
    expect(result.reasons).toEqual(
      expect.arrayContaining(["position_unavailable", "usage_unavailable"]),
    );
    expect(
      (
        await database.pool.query(
          "SELECT count(*)::int AS n FROM finance_budget_policy_previews WHERE user_id=$1",
          [f.userId],
        )
      ).rows[0].n,
    ).toBe(0);
    const proposal = await service.createProposal(f.context, {
      idempotencyKey: randomUUID(),
      policyId: policy.id,
      expected,
      candidate: f.candidate,
    });
    expect(proposal).toMatchObject({ state: "inactive", executionAvailable: false });
    const saved = await service.savePreview(f.context, proposal.id, {
      idempotencyKey: randomUUID(),
      expected,
      expectedProposalRevision: 1,
      expiresAt: "2026-09-21T00:00:00Z",
    });
    expect(saved.assessment).toEqual({
      stale: false,
      expired: false,
      proposalWithdrawn: false,
      policyDisabled: false,
    });
    await service.disablePolicy(f.context, policy.id, {
      idempotencyKey: randomUUID(),
      expectedLifecycleRevision: 1,
    });
    clock = new Date("2026-09-22T00:00:00Z");
    const historical = await service.getPreview(f.userId, proposal.id, saved.id);
    expect(historical.result).toEqual(saved.result);
    expect(historical.assessment).toMatchObject({
      stale: true,
      expired: true,
      policyDisabled: true,
    });
    await service.withdrawProposal(f.context, proposal.id, {
      idempotencyKey: randomUUID(),
      expectedLifecycleRevision: 1,
    });
    expect(
      (await service.getPreview(f.userId, proposal.id, saved.id)).assessment.proposalWithdrawn,
    ).toBe(true);
    expect(
      (
        await database.pool.query(
          "SELECT status,approved_by_actor_id FROM finance_budget_versions WHERE id=$1",
          [f.budgetId],
        )
      ).rows[0],
    ).toEqual({ status: "active", approved_by_actor_id: f.userId });
  });
  it("rejects agents and foreign owners without allowing bypass to grant management authority", async () => {
    const f = await fixture();
    const { policy, expected } = await f.ready();
    for (const context of [
      { ...f.context, actorType: "agent" as const, canSelfApprove: true },
      { ...f.context, canMutate: false },
    ]) {
      await expect(
        service.createPolicy(context, { ...f.policyInput, idempotencyKey: randomUUID() }),
      ).rejects.toMatchObject({ code: "forbidden" });
      await expect(
        service.disablePolicy(context, policy.id, {
          idempotencyKey: randomUUID(),
          expectedLifecycleRevision: 1,
        }),
      ).rejects.toMatchObject({ code: "forbidden" });
    }
    const other = await fixture();
    await expect(service.getPolicy(other.userId, policy.id)).rejects.toMatchObject({
      code: "not_found",
    });
    await expect(
      service.createProposal(f.context, {
        idempotencyKey: randomUUID(),
        policyId: policy.id,
        expected,
        candidate: { ...f.candidate, userId: other.userId },
      }),
    ).rejects.toMatchObject({ code: "invalid_request" });
    await expect(
      service.previewPolicy(f.userId, {
        policyId: policy.id,
        expected,
        candidate: f.candidate,
        usage: { state: "available", consumedCents: 0 },
      }),
    ).rejects.toThrow();
  });
  it("requires a confirmed human baseline and prevents timezone or policy replacement from resetting it", async () => {
    const f = await fixture();
    await expect(service.createPolicy(f.context, f.policyInput)).rejects.toMatchObject({
      code: "conflict",
    });
    const baseline = await service.designateBaseline(f.context, f.baselineInput);
    expect(baseline).toMatchObject({ budget: f.budget, executionAvailable: false });
    await expect(
      service.designateBaseline(f.context, {
        ...f.baselineInput,
        idempotencyKey: randomUUID(),
        period: { ...period, timezone: "UTC" },
      }),
    ).rejects.toMatchObject({ code: "conflict" });
  });
  it("serializes concurrent version allocation and same-key replay", async () => {
    const f = await fixture();
    const { policy } = await f.ready();
    const command = {
      idempotencyKey: randomUUID(),
      terms: f.terms,
      expectedProfile: f.profile,
      expectedLatestBudget: f.budget,
      expectedLifecycleRevision: 1,
      expectedLatestVersion: 1,
    };
    const both = await Promise.all([
      service.revisePolicy(f.context, policy.id, command),
      service.revisePolicy(f.context, policy.id, command),
    ]);
    expect(both[0]).toEqual(both[1]);
    const race = await Promise.allSettled(
      [1, 2].map(() =>
        service.revisePolicy(f.context, policy.id, {
          ...command,
          idempotencyKey: randomUUID(),
          expectedLatestVersion: 2,
        }),
      ),
    );
    expect(race.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(race.filter((r) => r.status === "rejected")).toHaveLength(1);
  });
  it.each([
    "userId",
    "planId",
    "policy",
    "policyLifecycleRevision",
    "profile",
    "baseline",
    "activeBudget",
    "latestBudget",
    "positionRevision",
    "usageRevision",
  ] as const)("rejects stale expected %s before saving a proposal", async (field) => {
    const f = await fixture();
    const { policy, expected } = await f.ready();
    const changed =
      field === "userId" || field === "planId"
        ? randomUUID()
        : field === "policyLifecycleRevision"
          ? 2
          : field === "positionRevision" || field === "usageRevision"
            ? "forged"
            : { id: randomUUID(), revision: "2" };
    await expect(
      service.createProposal(f.context, {
        idempotencyKey: randomUUID(),
        policyId: policy.id,
        expected: { ...expected, [field]: changed },
        candidate: f.candidate,
      }),
    ).rejects.toMatchObject({ code: "conflict" });
    expect(
      (
        await database.pool.query(
          "SELECT count(*)::int AS n FROM finance_budget_revision_proposals WHERE user_id=$1",
          [f.userId],
        )
      ).rows[0].n,
    ).toBe(0);
  });
  it.each([
    "spending",
    "savings",
    "goal",
    "debt",
    "buffer",
  ] as const)("rejects foreign nested %s targets", async (kind) => {
    const f = await fixture();
    const { policy, expected } = await f.ready();
    await expect(
      service.createProposal(f.context, {
        idempotencyKey: randomUUID(),
        policyId: policy.id,
        expected,
        candidate: {
          ...f.candidate,
          allocations: [{ ...f.candidate.allocations[0], kind, targetId: randomUUID() }],
        },
      }),
    ).rejects.toMatchObject({ code: "invalid_request" });
  });
  it.each([
    "opaque",
    "income-account",
    "reserve-stream",
    "foreign-account",
  ] as const)("retains %s budget resource provenance as unavailable evidence through management", async (sourceKind) => {
    const f = await fixture();
    const sourceId = randomUUID();
    if (sourceKind === "income-account" || sourceKind === "foreign-account") {
      const owner = sourceKind === "foreign-account" ? (await fixture()).userId : f.userId;
      await database.pool.query(
        "INSERT INTO finance_accounts(id,user_id,provider,institution,name) VALUES($1,$2,'manual','Test','Opaque provenance')",
        [sourceId, owner],
      );
    }
    if (sourceKind === "reserve-stream") {
      await database.pool.query(
        "INSERT INTO finance_income_streams(id,user_id,payer,display_name,cadence,expected_amount_cents,amount_tolerance_cents,confidence_basis_points,source) VALUES($1,$2,'Source','Source','monthly',10000,0,10000,'user')",
        [sourceId, f.userId],
      );
    }
    const resource = financeBudgetResourceSchema.parse({
      key: "income",
      kind: sourceKind === "reserve-stream" ? "reserve_draw" : "income",
      amount: 10000,
      sourceId,
    });
    await database.pool.query("UPDATE finance_budget_versions SET resources=$2 WHERE id=$1", [
      f.budgetId,
      JSON.stringify([resource]),
    ]);
    const candidate = {
      ...f.candidate,
      resources: [
        { key: resource.key, kind: resource.kind, sourceId, amountCents: resource.amount },
      ],
    };
    const { policy, expected } = await f.ready();
    const preview = await service.previewPolicy(f.userId, {
      policyId: policy.id,
      expected,
      candidate,
    });
    expect(preview.executionAvailable).toBe(false);
    expect(preview.reasons).toContain("missing_evidence");
    expect(preview.reasons).not.toContain("resource_changed");
    expect(preview.input.position.state).toBe("unavailable");
    expect(preview.input.candidate.resources).toEqual(candidate.resources);
    const proposal = await service.createProposal(f.context, {
      idempotencyKey: randomUUID(),
      policyId: policy.id,
      expected,
      candidate,
    });
    const saved = await service.savePreview(f.context, proposal.id, {
      idempotencyKey: randomUUID(),
      expected,
      expectedProposalRevision: 1,
      expiresAt: "2026-09-21T00:00:00Z",
    });
    const history = await service.getPreview(f.userId, proposal.id, saved.id);
    expect(history.result).toEqual(saved.result);
    expect(history.assessment.stale).toBe(false);
    expect(history.result.executionAvailable).toBe(false);
    const changed = await service.previewPolicy(f.userId, {
      policyId: policy.id,
      expected,
      candidate: { ...candidate, resources: [{ ...candidate.resources[0], sourceId: null }] },
    });
    expect(changed.reasons).toContain("resource_changed");
  });
  it("rejects missing required targets and wrong period", async () => {
    const f = await fixture();
    const { policy, expected } = await f.ready();
    for (const candidate of [
      { ...f.candidate, month: "2026-10" },
      {
        ...f.candidate,
        allocations: [{ key: "loan", kind: "debt", targetId: null, amountCents: 10000 }],
      },
    ])
      await expect(
        service.previewPolicy(f.userId, { policyId: policy.id, expected, candidate }),
      ).rejects.toMatchObject({ code: "invalid_request" });
  });
  it.each([
    "2026-09-20T12:00:00Z",
    "2026-10-02T00:00:00Z",
  ])("rejects invalid saved expiry %s", async (expiresAt) => {
    const f = await fixture();
    const { policy, expected } = await f.ready();
    const proposal = await service.createProposal(f.context, {
      idempotencyKey: randomUUID(),
      policyId: policy.id,
      expected,
      candidate: f.candidate,
    });
    await expect(
      service.savePreview(f.context, proposal.id, {
        idempotencyKey: randomUUID(),
        expected,
        expectedProposalRevision: 1,
        expiresAt,
      }),
    ).rejects.toMatchObject({ code: "conflict" });
  });
  it("preserves readable historical packets after terms are appended", async () => {
    const f = await fixture();
    const { policy, expected } = await f.ready();
    const proposal = await service.createProposal(f.context, {
      idempotencyKey: randomUUID(),
      policyId: policy.id,
      expected,
      candidate: f.candidate,
    });
    const saved = await service.savePreview(f.context, proposal.id, {
      idempotencyKey: randomUUID(),
      expected,
      expectedProposalRevision: 1,
      expiresAt: "2026-09-21T00:00:00Z",
    });
    await service.revisePolicy(f.context, policy.id, {
      idempotencyKey: randomUUID(),
      terms: { ...f.terms, monthlyCapCents: 3000 },
      expectedProfile: f.profile,
      expectedLatestBudget: f.budget,
      expectedLifecycleRevision: 1,
      expectedLatestVersion: 1,
    });
    expect((await service.getPreview(f.userId, proposal.id, saved.id)).result).toEqual(
      saved.result,
    );
  });
  it("rolls back proposal and audit together when audit persistence fails", async () => {
    const f = await fixture();
    const { policy, expected } = await f.ready();
    const idempotencyKey = randomUUID();
    await database.pool.query(
      "ALTER TABLE audit_events ADD CONSTRAINT test_policy_audit_failure CHECK (action <> 'finances.budget_policy.proposed') NOT VALID",
    );
    try {
      await expect(
        service.createProposal(f.context, {
          idempotencyKey,
          policyId: policy.id,
          expected,
          candidate: f.candidate,
        }),
      ).rejects.toThrow();
      expect(
        (
          await database.pool.query(
            "SELECT count(*)::int AS n FROM finance_budget_revision_proposals WHERE user_id=$1",
            [f.userId],
          )
        ).rows[0].n,
      ).toBe(0);
      expect(
        (
          await database.pool.query(
            "SELECT status FROM finance_mutation_records WHERE user_id=$1 AND idempotency_key=$2",
            [f.userId, idempotencyKey],
          )
        ).rows[0].status,
      ).toBe("failed");
    } finally {
      await database.pool.query(
        "ALTER TABLE audit_events DROP CONSTRAINT test_policy_audit_failure",
      );
    }
  });
  it("denies new saves after disable or withdrawal and still permits withdrawal after expiry", async () => {
    const f = await fixture();
    const { policy, expected } = await f.ready();
    const proposal = await service.createProposal(f.context, {
      idempotencyKey: randomUUID(),
      policyId: policy.id,
      expected,
      candidate: f.candidate,
    });
    await service.disablePolicy(f.context, policy.id, {
      idempotencyKey: randomUUID(),
      expectedLifecycleRevision: 1,
    });
    await expect(
      service.savePreview(f.context, proposal.id, {
        idempotencyKey: randomUUID(),
        expected,
        expectedProposalRevision: 1,
        expiresAt: "2026-09-21T00:00:00Z",
      }),
    ).rejects.toMatchObject({ code: "conflict" });
    clock = new Date("2026-11-01T00:00:00Z");
    const withdrawn = await service.withdrawProposal(f.context, proposal.id, {
      idempotencyKey: randomUUID(),
      expectedLifecycleRevision: 1,
    });
    expect(withdrawn.state).toBe("withdrawn");
    expect(
      (
        await service.withdrawProposal(f.context, proposal.id, {
          idempotencyKey: randomUUID(),
          expectedLifecycleRevision: 2,
        })
      ).lifecycleRevision,
    ).toBe(2);
    expect(
      (
        await service.disablePolicy(f.context, policy.id, {
          idempotencyKey: randomUUID(),
          expectedLifecycleRevision: 2,
        })
      ).lifecycleRevision,
    ).toBe(2);
  });
  it("rejects deleted owners before claiming a receipt", async () => {
    const f = await fixture();
    await database.pool.query("DELETE FROM users WHERE id=$1", [f.userId]);
    await expect(service.designateBaseline(f.context, f.baselineInput)).rejects.toMatchObject({
      code: "not_found",
    });
  });
  it("re-reads profile state after waiting behind the shared profile mutex", async () => {
    const f = await fixture();
    const { policy, expected } = await f.ready();
    const proposal = await service.createProposal(f.context, {
      idempotencyKey: randomUUID(),
      policyId: policy.id,
      expected,
      candidate: f.candidate,
    });
    const client = await database.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        `finance-profile:${f.userId}`,
      ]);
      await client.query("INSERT INTO finance_profile_versions(user_id,version) VALUES($1,2)", [
        f.userId,
      ]);
      const saving = service.savePreview(f.context, proposal.id, {
        idempotencyKey: randomUUID(),
        expected,
        expectedProposalRevision: 1,
        expiresAt: "2026-09-21T00:00:00Z",
      });
      const observed = expect(saving).rejects.toMatchObject({ code: "conflict" });
      await expect
        .poll(
          async () =>
            (
              await database.pool.query(
                "SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND wait_event='advisory' AND query LIKE '%pg_advisory_xact_lock%'",
              )
            ).rows[0].n,
          { timeout: 2_000, interval: 10 },
        )
        .toBe(1);
      await client.query("COMMIT");
      await observed;
      expect(
        (
          await database.pool.query(
            "SELECT count(*)::int AS n FROM finance_budget_policy_previews WHERE user_id=$1",
            [f.userId],
          )
        ).rows[0].n,
      ).toBe(0);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });
  it("invalidates a proposal after a person approves a newer active budget", async () => {
    const f = await fixture();
    const { policy, expected } = await f.ready();
    const proposal = await service.createProposal(f.context, {
      idempotencyKey: randomUUID(),
      policyId: policy.id,
      expected,
      candidate: f.candidate,
    });
    await database.pool.query("UPDATE finance_budget_versions SET status='retired' WHERE id=$1", [
      f.budgetId,
    ]);
    await database.pool.query(
      "INSERT INTO finance_budget_versions(user_id,plan_id,profile_version_id,version,status,effective_from,expected_resources_cents,allocated_total_cents,balance_delta_cents,rationale,approved_by_actor_type,approved_by_actor_id,approved_at) VALUES($1,$2,$3,2,'active','2026-09',10000,10000,0,'Replacement','user',$1::uuid::text,now())",
      [f.userId, f.planId, f.profileId],
    );
    await expect(
      service.savePreview(f.context, proposal.id, {
        idempotencyKey: randomUUID(),
        expected,
        expectedProposalRevision: 1,
        expiresAt: "2026-09-21T00:00:00Z",
      }),
    ).rejects.toMatchObject({ code: "conflict" });
    expect(
      (
        await database.pool.query(
          "SELECT budget_version_id FROM finance_budget_period_baselines WHERE user_id=$1",
          [f.userId],
        )
      ).rows[0].budget_version_id,
    ).toBe(f.budgetId);
  });
  it("keeps saved evidence readable after an allocation target is removed", async () => {
    const f = await fixture();
    const { policy, expected } = await f.ready();
    const target = randomUUID();
    await database.pool.query(
      "INSERT INTO finance_categories(id,user_id,name,slug,\"group\") VALUES($1,$2,'Optional','optional','spending')",
      [target, f.userId],
    );
    const candidate = {
      ...f.candidate,
      allocations: f.candidate.allocations.map((a) =>
        a.kind === "spending" ? { ...a, targetId: target } : a,
      ),
    };
    const proposal = await service.createProposal(f.context, {
      idempotencyKey: randomUUID(),
      policyId: policy.id,
      expected,
      candidate,
    });
    const saved = await service.savePreview(f.context, proposal.id, {
      idempotencyKey: randomUUID(),
      expected,
      expectedProposalRevision: 1,
      expiresAt: "2026-09-21T00:00:00Z",
    });
    await database.pool.query("DELETE FROM finance_categories WHERE id=$1", [target]);
    expect((await service.getPreview(f.userId, proposal.id, saved.id)).result).toEqual(
      saved.result,
    );
    await expect(
      service.savePreview(f.context, proposal.id, {
        idempotencyKey: randomUUID(),
        expected,
        expectedProposalRevision: 1,
        expiresAt: "2026-09-21T00:00:00Z",
      }),
    ).rejects.toMatchObject({ code: "invalid_request" });
  });
  it.each([
    "approved_by_actor_type = 'agent'",
    "approved_at = NULL",
    "status = 'proposed'",
    "status = 'incomplete', balance_delta_cents = 1, expected_resources_cents = 10001",
    "expected_resources_cents = 11000, allocated_total_cents = 11000",
  ])("rejects a non-human or incomplete baseline: %s", async (change) => {
    const f = await fixture();
    await database.pool.query(`UPDATE finance_budget_versions SET ${change} WHERE id=$1`, [
      f.budgetId,
    ]);
    await expect(service.designateBaseline(f.context, f.baselineInput)).rejects.toMatchObject({
      code: "conflict",
    });
  });
  it("rejects stale management refs and expired terms without blocking disable", async () => {
    const f = await fixture();
    const { policy } = await f.ready();
    await expect(
      service.revisePolicy(f.context, policy.id, {
        idempotencyKey: randomUUID(),
        terms: f.terms,
        expectedProfile: f.profile,
        expectedLatestBudget: f.budget,
        expectedLifecycleRevision: 2,
        expectedLatestVersion: 1,
      }),
    ).rejects.toMatchObject({ code: "conflict" });
    await expect(
      service.createPolicy(f.context, {
        ...f.policyInput,
        idempotencyKey: randomUUID(),
        expectedProfile: null,
      }),
    ).rejects.toMatchObject({ code: "conflict" });
    clock = new Date(f.terms.expiresAt);
    await expect(
      service.createPolicy(f.context, { ...f.policyInput, idempotencyKey: randomUUID() }),
    ).rejects.toMatchObject({ code: "conflict" });
    expect(
      (
        await service.disablePolicy(f.context, policy.id, {
          idempotencyKey: randomUUID(),
          expectedLifecycleRevision: 1,
        })
      ).state,
    ).toBe("disabled");
  });
  it("lists latest owned policy records with a bounded number of reads", async () => {
    const f = await fixture();
    const other = await fixture();
    await other.ready();
    const { policy } = await f.ready();
    const second = await service.createPolicy(f.context, {
      ...f.policyInput,
      idempotencyKey: randomUUID(),
    });
    const third = await service.createPolicy(f.context, {
      ...f.policyInput,
      idempotencyKey: randomUUID(),
    });
    const revised = await service.revisePolicy(f.context, policy.id, {
      expectedProfile: f.profile,
      expectedLatestBudget: f.budget,
      idempotencyKey: randomUUID(),
      expectedLifecycleRevision: 1,
      expectedLatestVersion: 1,
      terms: { ...f.terms, perChangeCapCents: 50 },
    });
    const queries: string[] = [];
    const measured = createFinanceBudgetPolicyService({
      db: drizzle(database.pool, {
        schema: databaseSchema,
        logger: {
          logQuery(query) {
            queries.push(query);
          },
        },
      }),
      now: () => clock,
    });
    const listed = await measured.listPolicies(f.userId, { limit: 100 });
    expect(listed).toEqual([revised, second, third].sort((a, b) => b.id.localeCompare(a.id)));
    expect(queries.filter((query) => /^select\b/i.test(query))).toHaveLength(3);
    expect(await measured.listPolicies(f.userId, { limit: 1, beforeId: listed[0]?.id })).toEqual([
      listed[1],
    ]);
    queries.length = 0;
    expect(await measured.listPolicies(randomUUID(), { limit: 100 })).toEqual([]);
    expect(queries.filter((query) => /^select\b/i.test(query))).toHaveLength(1);
    await database.pool.query(
      "INSERT INTO finance_budget_policies(user_id,plan_id,state,lifecycle_revision,created_by_actor_id) VALUES($1,$2,'draft',1,$1::uuid::text)",
      [f.userId, f.planId],
    );
    await expect(measured.listPolicies(f.userId, { limit: 100 })).rejects.toMatchObject({
      code: "conflict",
      message: "Budget policy terms are unavailable.",
    });
  });
  it("bounds lists and conceals foreign proposal and preview identities", async () => {
    const f = await fixture();
    const other = await fixture();
    const { policy, expected } = await f.ready();
    const p2 = await service.createPolicy(f.context, {
      ...f.policyInput,
      idempotencyKey: randomUUID(),
    });
    const first = await service.listPolicies(f.userId, { limit: 1 });
    const second = await service.listPolicies(f.userId, { limit: 1, beforeId: first[0]?.id });
    expect(new Set([first[0]?.id, second[0]?.id])).toEqual(new Set([policy.id, p2.id]));
    expect(await service.listPolicies(other.userId, { limit: 100 })).toEqual([]);
    const proposal = await service.createProposal(f.context, {
      idempotencyKey: randomUUID(),
      policyId: policy.id,
      expected,
      candidate: f.candidate,
    });
    expect((await service.getProposal(f.userId, proposal.id)).candidateHash).toBe(
      proposal.candidateHash,
    );
    await expect(service.getProposal(other.userId, proposal.id)).rejects.toMatchObject({
      code: "not_found",
    });
    await expect(service.getPreview(f.userId, proposal.id, randomUUID())).rejects.toMatchObject({
      code: "not_found",
    });
  });
  it("retains unknown profile and active budget evidence without inventing values", async () => {
    const f = await fixture();
    const { policy } = await f.ready();
    await database.pool.query(
      "UPDATE finance_budget_versions SET profile_version_id=NULL,status='retired' WHERE id=$1",
      [f.budgetId],
    );
    await database.pool.query("DELETE FROM finance_profile_versions WHERE user_id=$1", [f.userId]);
    const expected = {
      userId: f.userId,
      planId: f.planId,
      policy: { id: policy.latestVersion.id, revision: "1" },
      policyLifecycleRevision: 1,
      profile: null,
      baseline: f.budget,
      activeBudget: null,
      latestBudget: f.budget,
      positionRevision: null,
      usageRevision: null,
    };
    const result = await service.previewPolicy(f.userId, {
      policyId: policy.id,
      expected,
      candidate: f.candidate,
    });
    expect(result.input.current).toBeNull();
    expect(result.reasons).toContain("missing_evidence");
    const proposal = await service.createProposal(f.context, {
      idempotencyKey: randomUUID(),
      policyId: policy.id,
      expected,
      candidate: f.candidate,
    });
    const preview = await service.savePreview(f.context, proposal.id, {
      idempotencyKey: randomUUID(),
      expected,
      expectedProposalRevision: 1,
      expiresAt: "2026-09-21T00:00:00Z",
    });
    expect(preview.result.input.observed.profile).toBeNull();
    expect(preview.result.executionAvailable).toBe(false);
  });
  it("denies archived plans and malformed historical amounts", async () => {
    const f = await fixture();
    const { policy, expected } = await f.ready();
    await database.pool.query("UPDATE finance_budget_plans SET status='archived' WHERE id=$1", [
      f.planId,
    ]);
    expect(
      (
        await service.previewPolicy(f.userId, {
          policyId: policy.id,
          expected,
          candidate: f.candidate,
        })
      ).reasons,
    ).toContain("policy_unknown");
    await expect(
      service.createPolicy(f.context, { ...f.policyInput, idempotencyKey: randomUUID() }),
    ).rejects.toMatchObject({ code: "conflict" });
    await database.pool.query("UPDATE finance_budget_versions SET resources=$2 WHERE id=$1", [
      f.budgetId,
      JSON.stringify([{ key: "invalid", kind: "income", amount: "unknown" }]),
    ]);
    const preview = await service.previewPolicy(f.userId, {
      policyId: policy.id,
      expected,
      candidate: f.candidate,
    });
    expect(preview.input.current).toBeNull();
    expect(preview.input.baseline).toBeNull();
    expect(preview.reasons).toContain("missing_evidence");
  });
  it("rejects a foreign plan before creating a baseline", async () => {
    const f = await fixture();
    const other = await fixture();
    await expect(
      service.designateBaseline(f.context, { ...f.baselineInput, planId: other.planId }),
    ).rejects.toMatchObject({ code: "not_found" });
  });
  it("does not consume the monthly baseline slot for an archived plan", async () => {
    const f = await fixture();
    await database.pool.query("UPDATE finance_budget_plans SET status='archived' WHERE id=$1", [
      f.planId,
    ]);
    await expect(service.designateBaseline(f.context, f.baselineInput)).rejects.toMatchObject({
      code: "conflict",
    });
    expect(
      (
        await database.pool.query(
          "SELECT count(*)::int AS n FROM finance_budget_period_baselines WHERE user_id=$1",
          [f.userId],
        )
      ).rows[0].n,
    ).toBe(0);
  });
  it("returns checked conflicts at each persisted integer revision ceiling", async () => {
    const f = await fixture();
    const { policy, expected } = await f.ready();
    const proposal = await service.createProposal(f.context, {
      idempotencyKey: randomUUID(),
      policyId: policy.id,
      expected,
      candidate: f.candidate,
    });
    const ceilingProposal = (
      await database.pool.query(
        "INSERT INTO finance_budget_revision_proposals SELECT (jsonb_populate_record(NULL::finance_budget_revision_proposals,to_jsonb(v)||jsonb_build_object('id',gen_random_uuid(),'lifecycle_revision',2147483647))).* FROM finance_budget_revision_proposals v WHERE id=$1 RETURNING id",
        [proposal.id],
      )
    ).rows[0].id;
    await expect(
      service.withdrawProposal(f.context, ceilingProposal, {
        idempotencyKey: randomUUID(),
        expectedLifecycleRevision: 2147483647,
      }),
    ).rejects.toMatchObject({ code: "conflict" });
    await database.pool.query(
      "INSERT INTO finance_budget_policy_versions SELECT (jsonb_populate_record(NULL::finance_budget_policy_versions,to_jsonb(v)||jsonb_build_object('id',gen_random_uuid(),'version',2147483647))).* FROM finance_budget_policy_versions v WHERE id=$1",
      [policy.latestVersion.id],
    );
    await expect(
      service.revisePolicy(f.context, policy.id, {
        idempotencyKey: randomUUID(),
        terms: f.terms,
        expectedProfile: f.profile,
        expectedLatestBudget: f.budget,
        expectedLifecycleRevision: 1,
        expectedLatestVersion: 2147483647,
      }),
    ).rejects.toMatchObject({ code: "conflict" });
    const ceilingPolicy = (
      await database.pool.query(
        "INSERT INTO finance_budget_policies SELECT (jsonb_populate_record(NULL::finance_budget_policies,to_jsonb(v)||jsonb_build_object('id',gen_random_uuid(),'lifecycle_revision',2147483647))).* FROM finance_budget_policies v WHERE id=$1 RETURNING id",
        [policy.id],
      )
    ).rows[0].id;
    await database.pool.query(
      "INSERT INTO finance_budget_policy_versions SELECT (jsonb_populate_record(NULL::finance_budget_policy_versions,to_jsonb(v)||jsonb_build_object('id',gen_random_uuid(),'policy_id',$2::uuid))).* FROM finance_budget_policy_versions v WHERE id=$1",
      [policy.latestVersion.id, ceilingPolicy],
    );
    await expect(
      service.disablePolicy(f.context, ceilingPolicy, {
        idempotencyKey: randomUUID(),
        expectedLifecycleRevision: 2147483647,
      }),
    ).rejects.toMatchObject({ code: "conflict" });
  });

  it.each([
    "category",
    "account",
    "goal",
  ] as const)("keeps %s dependency locked through save and marks deletion stale", async (kind) => {
    const f = await fixture();
    const { policy, expected } = await f.ready();
    const target = randomUUID();
    const table = {
      category: "finance_categories",
      account: "finance_accounts",
      goal: "finance_goals",
    }[kind];
    if (kind === "category")
      await database.pool.query(
        "INSERT INTO finance_categories(id,user_id,name,slug,\"group\") VALUES($1,$2,'Target','target','spending')",
        [target, f.userId],
      );
    if (kind === "account")
      await database.pool.query(
        "INSERT INTO finance_accounts(id,user_id,provider,institution,name) VALUES($1,$2,'manual','Test','Target')",
        [target, f.userId],
      );
    if (kind === "goal")
      await database.pool.query(
        "INSERT INTO finance_goals(id,user_id,name,target_amount_cents) VALUES($1,$2,'Target',10000)",
        [target, f.userId],
      );
    const candidate = {
      ...f.candidate,
      allocations: [
        {
          key: "target",
          kind: kind === "category" ? "spending" : kind === "account" ? "debt" : "goal",
          targetId: target,
          amountCents: 10000,
        },
      ],
    };
    const proposal = await service.createProposal(f.context, {
      idempotencyKey: randomUUID(),
      policyId: policy.id,
      expected,
      candidate,
    });
    const gate = await database.pool.connect();
    const deleting = await database.pool.connect();
    try {
      await gate.query("BEGIN");
      await gate.query("LOCK TABLE audit_events IN SHARE MODE");
      const saving = service.savePreview(f.context, proposal.id, {
        idempotencyKey: randomUUID(),
        expected,
        expectedProposalRevision: 1,
        expiresAt: "2026-09-21T00:00:00Z",
      });
      await expect
        .poll(
          async () =>
            (
              await database.pool.query(
                "SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND wait_event='relation' AND query LIKE 'insert into \"audit_events\"%'",
              )
            ).rows[0].n,
          { timeout: 2000, interval: 10 },
        )
        .toBe(1);
      await deleting.query("BEGIN");
      await deleting.query("SET LOCAL lock_timeout='100ms'");
      await expect(
        deleting.query(`DELETE FROM ${table} WHERE id=$1`, [target]),
      ).rejects.toMatchObject({ code: "55P03" });
      await deleting.query("ROLLBACK");
      await gate.query("COMMIT");
      const saved = await saving;
      await database.pool.query(`DELETE FROM ${table} WHERE id=$1`, [target]);
      const historical = await service.getPreview(f.userId, proposal.id, saved.id);
      expect(historical.result).toEqual(saved.result);
      expect(historical.assessment.stale).toBe(true);
    } finally {
      await deleting.query("ROLLBACK");
      await gate.query("ROLLBACK");
      deleting.release();
      gate.release();
    }
  });
  async function cloneRow(table: string, id: string, changes: Record<string, unknown>) {
    return database.pool.query(
      `INSERT INTO ${table} SELECT (jsonb_populate_record(NULL::${table},to_jsonb(r)||$2::jsonb)).* FROM ${table} r WHERE id=$1 RETURNING id`,
      [id, JSON.stringify({ id: randomUUID(), ...changes })],
    );
  }
  it("rejects valid-value rewrites of every immutable row and root identity", async () => {
    const f = await fixture();
    const { policy, expected } = await f.ready();
    const proposal = await service.createProposal(f.context, {
      idempotencyKey: randomUUID(),
      policyId: policy.id,
      expected,
      candidate: f.candidate,
    });
    const preview = await service.savePreview(f.context, proposal.id, {
      idempotencyKey: randomUUID(),
      expected,
      expectedProposalRevision: 1,
      expiresAt: "2026-09-21T00:00:00Z",
    });
    for (const [table, id, change] of [
      ["finance_budget_policy_versions", policy.latestVersion.id, "monthly_cap_cents=3000"],
      ["finance_budget_policy_previews", preview.id, "expires_at='2026-09-20T20:00:00Z'"],
      ["finance_budget_period_baselines", null, "timezone='UTC'"],
      ["finance_budget_policies", policy.id, "created_by_actor_id='rewritten'"],
      ["finance_budget_policies", policy.id, "created_at=created_at+interval '1 second'"],
      [
        "finance_budget_revision_proposals",
        proposal.id,
        "candidate_hash='sha256:'||repeat('a',64)",
      ],
      ["finance_budget_revision_proposals", proposal.id, "profile_version_id=NULL"],
    ])
      await expect(
        database.pool.query(`UPDATE ${table} SET ${change} WHERE ${id ? "id=$1" : "user_id=$1"}`, [
          id ?? f.userId,
        ]),
      ).rejects.toMatchObject({ code: "23514" });
    await database.pool.query("DELETE FROM users WHERE id=$1", [f.userId]);
    expect(
      (
        await database.pool.query(
          "SELECT count(*)::int AS n FROM finance_budget_policy_previews WHERE user_id=$1",
          [f.userId],
        )
      ).rows[0].n,
    ).toBe(0);
  });
  it("rejects same-owner wrong-plan and wrong-proposal lineage", async () => {
    const f = await fixture();
    const { policy, expected } = await f.ready();
    const proposal = await service.createProposal(f.context, {
      idempotencyKey: randomUUID(),
      policyId: policy.id,
      expected,
      candidate: f.candidate,
    });
    const preview = await service.savePreview(f.context, proposal.id, {
      idempotencyKey: randomUUID(),
      expected,
      expectedProposalRevision: 1,
      expiresAt: "2026-09-21T00:00:00Z",
    });
    const otherPlan = randomUUID(),
      otherBudget = randomUUID();
    await database.pool.query("INSERT INTO finance_budget_plans(id,user_id) VALUES($1,$2)", [
      otherPlan,
      f.userId,
    ]);
    await database.pool.query(
      "INSERT INTO finance_budget_versions(id,plan_id,user_id,version,effective_from,expected_resources_cents,allocated_total_cents,balance_delta_cents,rationale) VALUES($1,$2,$3,1,'2026-09',0,0,0,'Other plan')",
      [otherBudget, otherPlan, f.userId],
    );
    await expect(
      cloneRow("finance_budget_policy_versions", policy.latestVersion.id, {
        version: 2,
        baseline_budget_version_id: otherBudget,
      }),
    ).rejects.toMatchObject({ code: "23503" });
    await expect(
      cloneRow("finance_budget_policy_versions", policy.latestVersion.id, {
        version: 2,
        plan_id: otherPlan,
      }),
    ).rejects.toMatchObject({ code: "23503" });
    for (const field of [
      "baseline_budget_version_id",
      "active_budget_version_id",
      "latest_budget_version_id",
    ])
      await expect(
        cloneRow("finance_budget_revision_proposals", proposal.id, { [field]: otherBudget }),
      ).rejects.toMatchObject({ code: "23503" });
    const p2 = await service.createPolicy(f.context, {
      ...f.policyInput,
      idempotencyKey: randomUUID(),
    });
    const wrongInput = {
      ...preview.result.input,
      observed: { ...expected, policy: { id: p2.latestVersion.id, revision: "1" } },
    };
    await expect(
      cloneRow("finance_budget_policy_previews", preview.id, {
        policy_version_id: p2.latestVersion.id,
        input_snapshot: wrongInput,
        result_snapshot: { ...preview.result, input: wrongInput, revisions: wrongInput.observed },
      }),
    ).rejects.toMatchObject({ code: "23503" });
    const otherProposal = await service.createProposal(f.context, {
      idempotencyKey: randomUUID(),
      policyId: p2.id,
      expected: wrongInput.observed,
      candidate: f.candidate,
    });
    await expect(
      cloneRow("finance_budget_policy_previews", preview.id, { proposal_id: otherProposal.id }),
    ).rejects.toMatchObject({ code: "23503" });
    const baseline = (
      await database.pool.query("SELECT id FROM finance_budget_period_baselines WHERE user_id=$1", [
        f.userId,
      ])
    ).rows[0].id;
    await expect(
      cloneRow("finance_budget_period_baselines", baseline, {
        budget_version_id: otherBudget,
        period_month: "2026-10",
        period_from: "2026-10-01",
        period_through: "2026-10-31",
      }),
    ).rejects.toMatchObject({ code: "23503" });
  });
  it("admits only strict immutable JSON packets readable by the public contract", async () => {
    const f = await fixture();
    const { policy, expected } = await f.ready();
    const proposal = await service.createProposal(f.context, {
      idempotencyKey: randomUUID(),
      policyId: policy.id,
      expected,
      candidate: f.candidate,
    });
    const preview = await service.savePreview(f.context, proposal.id, {
      idempotencyKey: randomUUID(),
      expected,
      expectedProposalRevision: 1,
      expiresAt: "2026-09-21T00:00:00Z",
    });
    for (const directions of [
      [{}],
      [{ allocationKey: "spending", direction: "execute" }],
      [{ allocationKey: "spending", direction: "both", grant: true }],
      [
        { allocationKey: "spending", direction: "both" },
        { allocationKey: "spending", direction: "increase" },
      ],
    ])
      await expect(
        cloneRow("finance_budget_policy_versions", policy.latestVersion.id, {
          version: 2,
          directions,
        }),
      ).rejects.toMatchObject({ code: "23514" });
    for (const protections of [
      [{}],
      [{ allocationKey: "buffer", minimumCents: -1 }],
      [
        { allocationKey: "buffer", minimumCents: 0 },
        { allocationKey: "buffer", minimumCents: 1 },
      ],
    ])
      await expect(
        cloneRow("finance_budget_policy_versions", policy.latestVersion.id, {
          version: 2,
          protections,
        }),
      ).rejects.toMatchObject({ code: "23514" });
    for (const candidate of [
      {},
      { ...f.candidate, grant: true },
      { ...f.candidate, resources: [{ ...f.candidate.resources[0], amountCents: 0.5 }] },
      { ...f.candidate, allocations: [f.candidate.allocations[0], f.candidate.allocations[0]] },
    ])
      await expect(
        cloneRow("finance_budget_revision_proposals", proposal.id, {
          candidate_snapshot: candidate,
        }),
      ).rejects.toMatchObject({ code: "23514" });
    for (const result of [
      {},
      { ...preview.result, grant: true },
      { ...preview.result, executionAvailable: true },
      { ...preview.result, reasons: [] },
      { ...preview.result, grossMovedCents: 999 },
      {
        ...preview.result,
        revisions: { ...preview.result.revisions, policyLifecycleRevision: 99 },
      },
    ])
      await expect(
        cloneRow("finance_budget_policy_previews", preview.id, { result_snapshot: result }),
      ).rejects.toMatchObject({ code: "23514" });
    await expect(
      cloneRow("finance_budget_policy_previews", preview.id, {
        input_snapshot: { ...preview.result.input, evaluatedAt: "2026-09-19T00:00:00Z" },
      }),
    ).rejects.toMatchObject({ code: "23514" });
  });
  it("agrees with public parsers on canonical packets and representative nested corruption", async () => {
    const f = await fixture();
    const { policy, expected } = await f.ready();
    const result = await service.previewPolicy(f.userId, {
      policyId: policy.id,
      expected,
      candidate: f.candidate,
    });
    const samples = [
      {
        kind: "plan",
        schema: financeBudgetPolicyPlanSnapshotSchema,
        good: f.candidate,
        bad: [
          {},
          { ...f.candidate, grant: true },
          { ...f.candidate, resources: [{ ...f.candidate.resources[0], sourceId: "not-a-uuid" }] },
          {
            ...f.candidate,
            allocations: [
              { ...f.candidate.allocations[0], key: "same" },
              { ...f.candidate.allocations[1], key: "same" },
            ],
          },
          {
            ...f.candidate,
            allocations: [
              { ...f.candidate.allocations[0], amountCents: 2147483647 },
              { ...f.candidate.allocations[1], amountCents: 1 },
            ],
          },
        ],
      },
      {
        kind: "terms",
        schema: financeBudgetPolicyTermsSchema,
        good: f.terms,
        bad: [
          { ...f.terms, grant: true },
          { ...f.terms, period: { ...f.terms.period, timezone: "Not/A_Zone" } },
          { ...f.terms, period: { ...f.terms.period, through: "2026-09-29" } },
          { ...f.terms, protections: [{ allocationKey: "buffer", minimumCents: 0, extra: true }] },
        ],
      },
      {
        kind: "input",
        schema: financeBudgetPolicyEvaluationInputSchema,
        good: result.input,
        bad: [
          {
            ...result.input,
            position: { state: "unavailable", reason: "missing_evidence", sources: [] },
          },
          {
            ...result.input,
            observed: { ...result.revisions, policy: { ...result.revisions.policy, extra: true } },
          },
          { ...result.input, evaluatedAt: "2026-02-30T00:00:00Z" },
        ],
      },
      {
        kind: "result",
        schema: financeBudgetPolicyEvaluationSchema,
        good: result,
        bad: [
          {
            ...result,
            deltas: [{ allocationKey: "x", beforeCents: 0, afterCents: 2, deltaCents: 1 }],
            grossMovedCents: 1,
          },
          { ...result, executionUnavailableReasons: ["authority_not_wired"] },
          { ...result, evaluatedAt: "2026-09-19T00:00:00Z" },
        ],
      },
    ];
    for (const sample of samples) {
      expect(sample.schema.safeParse(sample.good).success).toBe(true);
      expect(
        (
          await database.pool.query(
            "SELECT finance_budget_policy_json_valid($1::jsonb,$2) AS valid",
            [JSON.stringify(sample.good), sample.kind],
          )
        ).rows[0].valid,
      ).toBe(true);
      for (const bad of sample.bad) {
        expect(sample.schema.safeParse(bad).success).toBe(false);
        expect(
          (
            await database.pool.query(
              "SELECT finance_budget_policy_json_valid($1::jsonb,$2) AS valid",
              [JSON.stringify(bad), sample.kind],
            )
          ).rows[0].valid,
        ).toBe(false);
      }
    }
  });
  it("locks the sorted dependency union despite reversed candidate order and rejects a deletion winner", async () => {
    const f = await fixture();
    const { policy, expected } = await f.ready();
    const first = "10000000-0000-4000-8000-000000000001",
      last = "f0000000-0000-4000-8000-000000000002";
    for (const id of [first, last])
      await database.pool.query(
        "INSERT INTO finance_categories(id,user_id,name,slug,\"group\") VALUES($1,$2,'Ordered',$1::uuid::text,'spending')",
        [id, f.userId],
      );
    const candidate = {
      ...f.candidate,
      allocations: [
        { key: "last", kind: "spending", targetId: last, amountCents: 5000 },
        { key: "first", kind: "spending", targetId: first, amountCents: 5000 },
      ],
    };
    const holding = await database.pool.connect();
    const deleting = await database.pool.connect();
    try {
      await holding.query("BEGIN");
      await holding.query("SELECT id FROM finance_categories WHERE id=$1 FOR UPDATE", [last]);
      const proposing = service.createProposal(f.context, {
        idempotencyKey: randomUUID(),
        policyId: policy.id,
        expected,
        candidate,
      });
      const outcome = expect(proposing).rejects.toMatchObject({ code: "invalid_request" });
      await expect
        .poll(
          async () =>
            (
              await database.pool.query(
                "SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND wait_event='transactionid' AND query LIKE '%finance_categories%'",
              )
            ).rows[0].n,
          { timeout: 2000, interval: 10 },
        )
        .toBe(1);
      await deleting.query("BEGIN");
      await deleting.query("SET LOCAL lock_timeout='100ms'");
      await expect(
        deleting.query("DELETE FROM finance_categories WHERE id=$1", [first]),
      ).rejects.toMatchObject({ code: "55P03" });
      await deleting.query("ROLLBACK");
      await holding.query("DELETE FROM finance_categories WHERE id=$1", [last]);
      await holding.query("COMMIT");
      await outcome;
      expect(
        (
          await database.pool.query(
            "SELECT count(*)::int AS n FROM finance_budget_revision_proposals WHERE user_id=$1",
            [f.userId],
          )
        ).rows[0].n,
      ).toBe(0);
    } finally {
      await holding.query("ROLLBACK");
      await deleting.query("ROLLBACK");
      holding.release();
      deleting.release();
    }
  });
  it("rejects an active budget from another plan as a checked conflict", async () => {
    const f = await fixture();
    const { policy, expected } = await f.ready();
    const plan = randomUUID(),
      budget = randomUUID();
    await database.pool.query("INSERT INTO finance_budget_plans(id,user_id) VALUES($1,$2)", [
      plan,
      f.userId,
    ]);
    await database.pool.query("UPDATE finance_budget_versions SET status='retired' WHERE id=$1", [
      f.budgetId,
    ]);
    await database.pool.query(
      "INSERT INTO finance_budget_versions(id,plan_id,user_id,version,status,effective_from,expected_resources_cents,allocated_total_cents,balance_delta_cents,rationale) VALUES($1,$2,$3,1,'active','2026-09',0,0,0,'Other plan')",
      [budget, plan, f.userId],
    );
    await expect(
      service.createProposal(f.context, {
        idempotencyKey: randomUUID(),
        policyId: policy.id,
        expected: { ...expected, activeBudget: { id: budget, revision: "1" } },
        candidate: f.candidate,
      }),
    ).rejects.toMatchObject({ code: "conflict" });
  });
  it("keeps validation independent of session settings and accepts known timezone aliases", async () => {
    const f = await fixture();
    const client = await database.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL DateStyle='German, DMY'");
      await client.query("SET LOCAL TimeZone='Pacific/Auckland'");
      for (const timezone of [
        "UTC",
        "America/New_York",
        "america/new_york",
        "US/Eastern",
        "Asia/Kathmandu",
        "Europe/London",
      ]) {
        const terms = { ...f.terms, period: { ...f.terms.period, timezone } };
        expect(financeBudgetPolicyTermsSchema.safeParse(terms).success).toBe(true);
        expect(
          (
            await client.query(
              "SELECT finance_budget_policy_json_valid($1::jsonb,'terms') AS valid",
              [JSON.stringify(terms)],
            )
          ).rows[0].valid,
        ).toBe(true);
      }
      for (const allocations of [
        [
          { ...f.candidate.allocations[0], key: "foo" },
          { ...f.candidate.allocations[1], key: "\vfoo" },
        ],
        [{ ...f.candidate.allocations[0], key: "😀".repeat(61) }],
      ]) {
        const candidate = { ...f.candidate, allocations };
        expect(financeBudgetPolicyPlanSnapshotSchema.safeParse(candidate).success).toBe(false);
        expect(
          (
            await client.query(
              "SELECT finance_budget_policy_json_valid($1::jsonb,'plan') AS valid",
              [JSON.stringify(candidate)],
            )
          ).rows[0].valid,
        ).toBe(false);
      }
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });
});
