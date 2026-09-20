import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { createDatabaseClient, type DatabaseClient, migrateDatabase } from "@personal-os/database";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
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
  it("rejects foreign resources, missing required targets, wrong period and forged evidence", async () => {
    const f = await fixture();
    const { policy, expected } = await f.ready();
    for (const candidate of [
      { ...f.candidate, month: "2026-10" },
      {
        ...f.candidate,
        allocations: [{ key: "loan", kind: "debt", targetId: null, amountCents: 10000 }],
      },
      { ...f.candidate, resources: [{ ...f.candidate.resources[0], sourceId: randomUUID() }] },
      {
        ...f.candidate,
        resources: [{ ...f.candidate.resources[0], kind: "reserve_draw", sourceId: randomUUID() }],
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
  it("preserves readable historical packets when current terms move to a new month", async () => {
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
    // Simulate a later valid month version; historical packets must not depend on the current candidate scope.
    await database.pool.query(
      "UPDATE finance_budget_policy_versions SET period_month='2026-10',period_from='2026-10-01',period_through='2026-10-31' WHERE id=$1",
      [policy.latestVersion.id],
    );
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
});
