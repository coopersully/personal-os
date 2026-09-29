import { resolve } from "node:path";
import {
  createDatabaseClient,
  financeLedgerChallengeFindings,
  financeMaintenanceCandidateItems,
  financeMaintenanceCandidates,
  migrateDatabase,
  users,
  workspaceMaintenanceRuns,
} from "@personal-os/database";
import { financeLedgerChallengeChecks } from "@personal-os/domain";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { eq } from "drizzle-orm";
import { createFinanceActionService } from "./finance-action-service.js";
import { createFinanceChallengeService } from "./finance-challenge-service.js";
import { createFinanceService } from "./finance-service.js";
import type { Principal } from "./types.js";
import { createWorkspaceMaintenanceService } from "./workspace-maintenance-service.js";

const now = new Date("2026-08-21T12:00:00.000Z");

describe.sequential("Finance ledger challenge", () => {
  let container: StartedPostgreSqlContainer;
  let database: ReturnType<typeof createDatabaseClient>;

  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:17.5-alpine")
      .withDatabase("personal_os")
      .withUsername("personal_os")
      .withPassword("personal_os")
      .start();
    database = createDatabaseClient(container.getConnectionUri());
    await migrateDatabase(database.db, resolve(process.cwd(), "packages/database/migrations"));
  }, 120_000);

  afterAll(async () => {
    await database.close();
    await container.stop();
  });

  async function fixture() {
    const [owner] = await database.db
      .insert(users)
      .values({
        displayName: "Challenge owner",
        email: `challenge-${crypto.randomUUID()}@example.com`,
        passwordHash: "unused",
        planningTimezone: "UTC",
      })
      .returning();
    if (!owner) throw new Error("Challenge owner was not created.");
    const finances = createFinanceService({ db: database.db, now: () => now });
    const actions = createFinanceActionService({ db: database.db, finances, now: () => now });
    const maintenance = createWorkspaceMaintenanceService({ db: database.db, now: () => now });
    const run = await maintenance.createOrResume(
      owner.id,
      "finances",
      { type: "all_outstanding" },
      `sha256:${"a".repeat(64)}`,
    );
    const draft = await actions.prepareMaintenanceCandidateDraft(
      "alert",
      { operation: "refresh" },
      owner.id,
    );
    const [candidate] = await database.db
      .insert(financeMaintenanceCandidates)
      .values({
        revision: `sha256:${"b".repeat(64)}`,
        runId: run.id,
        state: "preparing",
        userId: owner.id,
      })
      .returning();
    if (!candidate) throw new Error("Challenge candidate was not created.");
    const [item] = await database.db
      .insert(financeMaintenanceCandidateItems)
      .values({ ...draft, candidateId: candidate.id, ordinal: 0 })
      .returning();
    if (!item) throw new Error("Challenge item was not created.");
    const snapshot = await finances.maintenanceCandidateSnapshot(
      owner.id,
      run.scope,
      [item],
      candidate.discoveryRevision,
    );
    const [ready] = await database.db
      .update(financeMaintenanceCandidates)
      .set({
        projection: snapshot.projection,
        revision: snapshot.revision,
        state: "ready_for_challenge",
      })
      .where(eq(financeMaintenanceCandidates.id, candidate.id))
      .returning();
    if (!ready) throw new Error("Challenge candidate was not finalized.");
    await database.db
      .update(workspaceMaintenanceRuns)
      .set({
        checkpoint: { candidateId: ready.id, phase: "challenge", revision: ready.revision },
        status: "awaiting_agent_challenge",
      })
      .where(eq(workspaceMaintenanceRuns.id, run.id));
    return {
      challenge: createFinanceChallengeService({
        actions,
        db: database.db,
        finances,
        now: () => now,
      }),
      context: {
        principal: {
          actorId: "connected-finance-agent",
          actorType: "agent",
          scopes: new Set(["finances:maintain"]),
          userId: owner.id,
        } satisfies Principal,
        requestId: "challenge-submit",
      },
      finances,
      item,
      owner,
      ready,
      run,
    };
  }

  it("pages the complete rubric and resumes the same run after an exact submission", async () => {
    const setup = await fixture();
    const prepared = await setup.challenge.prepare(setup.owner.id, setup.run.id, setup.ready.id);
    await expect(
      setup.challenge.prepare(setup.owner.id, setup.run.id, setup.ready.id),
    ).resolves.toEqual(prepared);
    const page = await setup.challenge.getPage(setup.owner.id, prepared.id);
    expect(page.checks).toEqual(financeLedgerChallengeChecks);
    expect(page.items.map((item) => item.id)).toEqual([setup.item.id]);
    expect(page.items[0]).not.toHaveProperty("privatePayload");
    const input = {
      candidateRevision: setup.ready.revision,
      challengeId: prepared.id,
      checked: [...financeLedgerChallengeChecks],
      findings: [
        {
          candidateItemId: setup.item.id,
          evidence: "The alert refresh is bounded and does not alter ledger totals.",
          kind: "observation" as const,
          rationale: "No contradiction was found.",
          resolution: { type: "keep" as const },
          severity: "info" as const,
          sourceRefs: [],
        },
      ],
      reviewedItemIds: [setup.item.id],
      rubricVersion: "finance-ledger-challenge-v1" as const,
    };
    await expect(setup.challenge.submit(input, setup.context)).resolves.toMatchObject({
      state: "submitted",
      submittingAgentId: "connected-finance-agent",
    });
    await expect(setup.challenge.submit(input, setup.context)).resolves.toMatchObject({
      state: "submitted",
    });
    const originalFinding = input.findings[0];
    if (!originalFinding) throw new Error("Challenge finding fixture is missing.");
    await expect(
      setup.challenge.submit(
        { ...input, findings: [{ ...originalFinding, rationale: "Changed body." }] },
        setup.context,
      ),
    ).rejects.toMatchObject({ code: "conflict" });
    await expect(
      database.db
        .select()
        .from(financeLedgerChallengeFindings)
        .where(eq(financeLedgerChallengeFindings.challengeId, prepared.id)),
    ).resolves.toHaveLength(1);
    await expect(
      database.db
        .select({ status: workspaceMaintenanceRuns.status })
        .from(workspaceMaintenanceRuns)
        .where(eq(workspaceMaintenanceRuns.id, setup.run.id)),
    ).resolves.toEqual([{ status: "queued" }]);
    await expect(setup.challenge.resolve(setup.owner.id, setup.run.id)).resolves.toMatchObject({
      candidateId: setup.ready.id,
      candidateRevision: setup.ready.revision,
      questions: 0,
      submittingAgentId: "connected-finance-agent",
    });
    await expect(setup.challenge.resolve(setup.owner.id, setup.run.id)).resolves.toMatchObject({
      candidateId: setup.ready.id,
      candidateRevision: setup.ready.revision,
      questions: 0,
      submittingAgentId: "connected-finance-agent",
    });
  });

  it("rejects incomplete item and rubric coverage", async () => {
    const setup = await fixture();
    const prepared = await setup.challenge.prepare(setup.owner.id, setup.run.id, setup.ready.id);
    await expect(
      setup.challenge.submit(
        {
          candidateRevision: setup.ready.revision,
          challengeId: prepared.id,
          checked: financeLedgerChallengeChecks.slice(1),
          findings: [],
          reviewedItemIds: [],
          rubricVersion: "finance-ledger-challenge-v1",
        },
        setup.context,
      ),
    ).rejects.toBeDefined();
  });

  it("rejects preparation when candidate readiness or revision evidence changes", async () => {
    const notReady = await fixture();
    await database.db
      .update(financeMaintenanceCandidates)
      .set({ state: "preparing" })
      .where(eq(financeMaintenanceCandidates.id, notReady.ready.id));
    await expect(
      notReady.challenge.prepare(notReady.owner.id, notReady.run.id, notReady.ready.id),
    ).rejects.toMatchObject({ code: "conflict" });

    const stale = await fixture();
    await stale.challenge.prepare(stale.owner.id, stale.run.id, stale.ready.id);
    await database.db
      .update(financeMaintenanceCandidates)
      .set({ revision: `sha256:${"f".repeat(64)}` })
      .where(eq(financeMaintenanceCandidates.id, stale.ready.id));
    await expect(
      stale.challenge.prepare(stale.owner.id, stale.run.id, stale.ready.id),
    ).rejects.toMatchObject({ code: "conflict" });
  });

  it("rejects foreign, stale, duplicate, and non-agent challenge submissions", async () => {
    const missing = await fixture();
    await expect(
      missing.challenge.getPage(missing.owner.id, crypto.randomUUID()),
    ).rejects.toMatchObject({ code: "not_found" });
    await expect(
      missing.challenge.submit(
        {
          candidateRevision: missing.ready.revision,
          challengeId: crypto.randomUUID(),
          checked: [...financeLedgerChallengeChecks],
          findings: [],
          reviewedItemIds: [missing.item.id],
          rubricVersion: "finance-ledger-challenge-v1",
        },
        {
          principal: {
            actorId: missing.owner.id,
            actorType: "user",
            scopes: new Set(),
            userId: missing.owner.id,
          },
          requestId: "challenge-user-submit",
        },
      ),
    ).rejects.toMatchObject({ code: "forbidden" });

    const notFound = await fixture();
    await expect(
      notFound.challenge.submit(
        {
          candidateRevision: notFound.ready.revision,
          challengeId: crypto.randomUUID(),
          checked: [...financeLedgerChallengeChecks],
          findings: [],
          reviewedItemIds: [notFound.item.id],
          rubricVersion: "finance-ledger-challenge-v1",
        },
        notFound.context,
      ),
    ).rejects.toMatchObject({ code: "not_found" });

    const duplicate = await fixture();
    const duplicateChallenge = await duplicate.challenge.prepare(
      duplicate.owner.id,
      duplicate.run.id,
      duplicate.ready.id,
    );
    const duplicateCheck = financeLedgerChallengeChecks[0];
    if (!duplicateCheck) throw new Error("Expected at least one ledger challenge check.");
    await expect(
      duplicate.challenge.submit(
        {
          candidateRevision: duplicate.ready.revision,
          challengeId: duplicateChallenge.id,
          checked: [duplicateCheck, duplicateCheck, ...financeLedgerChallengeChecks.slice(2)],
          findings: [],
          reviewedItemIds: [duplicate.item.id],
          rubricVersion: "finance-ledger-challenge-v1",
        },
        duplicate.context,
      ),
    ).rejects.toThrow("Challenge checks must be unique");

    const stale = await fixture();
    const staleChallenge = await stale.challenge.prepare(
      stale.owner.id,
      stale.run.id,
      stale.ready.id,
    );
    await database.db
      .update(financeMaintenanceCandidates)
      .set({ state: "superseded" })
      .where(eq(financeMaintenanceCandidates.id, stale.ready.id));
    await expect(
      stale.challenge.submit(
        {
          candidateRevision: stale.ready.revision,
          challengeId: staleChallenge.id,
          checked: [...financeLedgerChallengeChecks],
          findings: [],
          reviewedItemIds: [stale.item.id],
          rubricVersion: "finance-ledger-challenge-v1",
        },
        stale.context,
      ),
    ).rejects.toMatchObject({ code: "conflict" });
  });

  it("applies bounded remove, replacement, and question findings to the challenged packet", async () => {
    const cases = [
      {
        disposition: "removed",
        kind: "correction" as const,
        resolution: { type: "remove" as const },
      },
      {
        disposition: "prepared",
        kind: "correction" as const,
        resolution: {
          actionKind: "alert" as const,
          input: { operation: "refresh" },
          type: "replace" as const,
        },
      },
      {
        disposition: "question",
        kind: "question" as const,
        resolution: {
          choices: ["Keep", "Remove"],
          prompt: "Should this alert refresh remain in the maintenance packet?",
          type: "question" as const,
          why: "The evidence is intentionally ambiguous for this challenge fixture.",
        },
      },
    ];
    for (const itemCase of cases) {
      const setup = await fixture();
      const localTransactionId = crypto.randomUUID();
      if (itemCase.kind === "question") {
        await database.db
          .update(financeMaintenanceCandidateItems)
          .set({
            actionKind: "categorization",
            privatePayload: {
              actionKind: "categorization",
              input: { decisions: [{ transactionId: localTransactionId }] },
            },
            sourceRefs: [
              {
                accountId: crypto.randomUUID(),
                provider: "plaid",
                remoteId: "provider-transaction-id",
                revision: now.toISOString(),
                sourceType: "finance_transaction",
              },
            ],
          })
          .where(eq(financeMaintenanceCandidateItems.id, setup.item.id));
        const [updatedItem] = await database.db
          .select()
          .from(financeMaintenanceCandidateItems)
          .where(eq(financeMaintenanceCandidateItems.id, setup.item.id));
        if (!updatedItem) throw new Error("Connected-provider challenge item was not updated.");
        const snapshot = await setup.finances.maintenanceCandidateSnapshot(
          setup.owner.id,
          setup.run.scope,
          [updatedItem],
          setup.ready.discoveryRevision,
        );
        await database.db
          .update(financeMaintenanceCandidates)
          .set({ projection: snapshot.projection, revision: snapshot.revision })
          .where(eq(financeMaintenanceCandidates.id, setup.ready.id));
        await database.db
          .update(workspaceMaintenanceRuns)
          .set({
            checkpoint: {
              candidateId: setup.ready.id,
              phase: "challenge",
              revision: snapshot.revision,
            },
          })
          .where(eq(workspaceMaintenanceRuns.id, setup.run.id));
        setup.ready.revision = snapshot.revision;
      }
      const prepared = await setup.challenge.prepare(setup.owner.id, setup.run.id, setup.ready.id);
      await expect(
        setup.challenge.submit(
          {
            candidateRevision: setup.ready.revision,
            challengeId: prepared.id,
            checked: [...financeLedgerChallengeChecks],
            findings: [
              {
                candidateItemId: setup.item.id,
                evidence: "The packet evidence supports this bounded challenge disposition.",
                kind: itemCase.kind,
                rationale: "Exercise the durable semantic challenge resolution.",
                resolution: itemCase.resolution,
                severity: itemCase.kind === "question" ? "warning" : "info",
                sourceRefs: [],
              },
            ],
            reviewedItemIds: [setup.item.id],
            rubricVersion: "finance-ledger-challenge-v1",
          },
          setup.context,
        ),
      ).resolves.toMatchObject({ state: "submitted" });
      await expect(
        database.db
          .select({
            disposition: financeMaintenanceCandidateItems.disposition,
            privatePayload: financeMaintenanceCandidateItems.privatePayload,
          })
          .from(financeMaintenanceCandidateItems)
          .where(eq(financeMaintenanceCandidateItems.id, setup.item.id)),
      ).resolves.toEqual([expect.objectContaining({ disposition: itemCase.disposition })]);
      if (itemCase.kind === "question") {
        const [saved] = await database.db
          .select({ privatePayload: financeMaintenanceCandidateItems.privatePayload })
          .from(financeMaintenanceCandidateItems)
          .where(eq(financeMaintenanceCandidateItems.id, setup.item.id));
        expect(saved?.privatePayload).toMatchObject({ transactionId: localTransactionId });
      }
    }
  });

  it("preserves direct transaction and review lineage when challenge evidence becomes a question", async () => {
    const setup = await fixture();
    const transactionId = crypto.randomUUID();
    const reviewCaseId = crypto.randomUUID();
    await database.db
      .update(financeMaintenanceCandidateItems)
      .set({
        actionKind: "categorization",
        privatePayload: {
          actionKind: "categorization",
          input: { decisions: [{ transactionId }] },
          reviewCaseId,
          reviewReason: "merchant_identity",
          transactionId,
        },
      })
      .where(eq(financeMaintenanceCandidateItems.id, setup.item.id));
    const [updatedItem] = await database.db
      .select()
      .from(financeMaintenanceCandidateItems)
      .where(eq(financeMaintenanceCandidateItems.id, setup.item.id));
    if (!updatedItem) throw new Error("Direct-lineage challenge item was not updated.");
    const snapshot = await setup.finances.maintenanceCandidateSnapshot(
      setup.owner.id,
      setup.run.scope,
      [updatedItem],
      setup.ready.discoveryRevision,
    );
    await database.db
      .update(financeMaintenanceCandidates)
      .set({ projection: snapshot.projection, revision: snapshot.revision })
      .where(eq(financeMaintenanceCandidates.id, setup.ready.id));
    await database.db
      .update(workspaceMaintenanceRuns)
      .set({
        checkpoint: {
          candidateId: setup.ready.id,
          phase: "challenge",
          revision: snapshot.revision,
        },
      })
      .where(eq(workspaceMaintenanceRuns.id, setup.run.id));
    const prepared = await setup.challenge.prepare(setup.owner.id, setup.run.id, setup.ready.id);

    await expect(
      setup.challenge.submit(
        {
          candidateRevision: snapshot.revision,
          challengeId: prepared.id,
          checked: [...financeLedgerChallengeChecks],
          findings: [
            {
              candidateItemId: setup.item.id,
              evidence: "The category still depends on the person's merchant context.",
              kind: "question",
              rationale: "Preserve the exact review lineage while asking for clarification.",
              resolution: {
                choices: ["Keep", "Change"],
                prompt: "How should this merchant be categorized?",
                type: "question",
                why: "The merchant identity is ambiguous.",
              },
              severity: "warning",
              sourceRefs: [],
            },
          ],
          reviewedItemIds: [setup.item.id],
          rubricVersion: "finance-ledger-challenge-v1",
        },
        setup.context,
      ),
    ).resolves.toMatchObject({ state: "submitted" });
    await expect(
      database.db
        .select({ privatePayload: financeMaintenanceCandidateItems.privatePayload })
        .from(financeMaintenanceCandidateItems)
        .where(eq(financeMaintenanceCandidateItems.id, setup.item.id)),
    ).resolves.toEqual([
      expect.objectContaining({
        privatePayload: expect.objectContaining({
          reviewCaseId,
          reviewReason: "merchant_identity",
          transactionId,
        }),
      }),
    ]);
  });

  it("rejects findings outside the challenged packet and unsupported resolutions", async () => {
    const cases = [
      {
        candidateItemId: crypto.randomUUID(),
        evidence: "Foreign item.",
        kind: "observation" as const,
        rationale: "Foreign item.",
        resolution: { type: "keep" as const },
        severity: "info" as const,
        sourceRefs: [],
      },
      {
        candidateItemId: "OWNED_ITEM",
        evidence: "Unsupported observation resolution.",
        kind: "observation" as const,
        rationale: "Unsupported resolution.",
        resolution: {
          choices: ["Yes"],
          prompt: "Continue?",
          type: "question" as const,
          why: "Test.",
        },
        severity: "info" as const,
        sourceRefs: [],
      },
      {
        candidateItemId: "OWNED_ITEM",
        evidence: "This question has no transaction lineage.",
        kind: "question" as const,
        rationale: "Nontransaction questions cannot be projected into the Finance Inbox.",
        resolution: {
          choices: ["Yes", "No"],
          prompt: "Should this alert refresh continue?",
          type: "question" as const,
          why: "The alert is not tied to one transaction.",
        },
        severity: "warning" as const,
        sourceRefs: [],
      },
      {
        candidateItemId: null,
        evidence: "Actionable findings require exact candidate lineage.",
        kind: "blocker" as const,
        rationale: "The finding is missing its candidate item.",
        resolution: {
          choices: ["Retry"],
          prompt: "Retry this item?",
          type: "question" as const,
          why: "The item identity is required.",
        },
        severity: "blocker" as const,
        sourceRefs: [],
      },
      {
        candidateItemId: "OWNED_ITEM",
        evidence: "Foreign source evidence must not enter this challenge.",
        kind: "observation" as const,
        rationale: "The source reference is outside the packet.",
        resolution: { type: "keep" as const },
        severity: "info" as const,
        sourceRefs: [
          {
            accountId: crypto.randomUUID(),
            provider: "plaid" as const,
            remoteId: "foreign-transaction",
            revision: now.toISOString(),
            sourceType: "finance_transaction" as const,
          },
        ],
      },
      {
        candidateItemId: "OWNED_ITEM",
        evidence: "Replacement questions need one exact transaction lineage.",
        kind: "correction" as const,
        rationale: "A missing transaction cannot produce an actionable replacement question.",
        resolution: {
          actionKind: "transaction" as const,
          input: {
            category: "Missing transaction",
            id: crypto.randomUUID(),
          },
          type: "replace" as const,
        },
        severity: "warning" as const,
        sourceRefs: [],
      },
    ];
    for (const finding of cases) {
      const setup = await fixture();
      const prepared = await setup.challenge.prepare(setup.owner.id, setup.run.id, setup.ready.id);
      await expect(
        setup.challenge.submit(
          {
            candidateRevision: setup.ready.revision,
            challengeId: prepared.id,
            checked: [...financeLedgerChallengeChecks],
            findings: [
              {
                ...finding,
                candidateItemId:
                  finding.candidateItemId === "OWNED_ITEM"
                    ? setup.item.id
                    : finding.candidateItemId,
              },
            ],
            reviewedItemIds: [setup.item.id],
            rubricVersion: "finance-ledger-challenge-v1",
          },
          setup.context,
        ),
      ).rejects.toMatchObject({ code: "invalid_request" });
    }

    const staleRun = await fixture();
    const prepared = await staleRun.challenge.prepare(
      staleRun.owner.id,
      staleRun.run.id,
      staleRun.ready.id,
    );
    await database.db
      .update(workspaceMaintenanceRuns)
      .set({ checkpoint: null })
      .where(eq(workspaceMaintenanceRuns.id, staleRun.run.id));
    await expect(
      staleRun.challenge.submit(
        {
          candidateRevision: staleRun.ready.revision,
          challengeId: prepared.id,
          checked: [...financeLedgerChallengeChecks],
          findings: [],
          reviewedItemIds: [staleRun.item.id],
          rubricVersion: "finance-ledger-challenge-v1",
        },
        staleRun.context,
      ),
    ).rejects.toMatchObject({ code: "conflict" });

    const drifted = await fixture();
    const driftedChallenge = await drifted.challenge.prepare(
      drifted.owner.id,
      drifted.run.id,
      drifted.ready.id,
    );
    await database.db
      .update(financeMaintenanceCandidateItems)
      .set({ fingerprint: `sha256:${"e".repeat(64)}` })
      .where(eq(financeMaintenanceCandidateItems.id, drifted.item.id));
    await expect(
      drifted.challenge.submit(
        {
          candidateRevision: drifted.ready.revision,
          challengeId: driftedChallenge.id,
          checked: [...financeLedgerChallengeChecks],
          findings: [],
          reviewedItemIds: [drifted.item.id],
          rubricVersion: "finance-ledger-challenge-v1",
        },
        drifted.context,
      ),
    ).rejects.toMatchObject({ code: "conflict" });
    await expect(drifted.challenge.resolve(drifted.owner.id, drifted.run.id)).rejects.toMatchObject(
      { code: "conflict" },
    );
  });
});
