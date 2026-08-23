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
    await expect(setup.challenge.resolve(setup.owner.id, setup.run.id)).rejects.toMatchObject({
      code: "conflict",
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
          .select({ disposition: financeMaintenanceCandidateItems.disposition })
          .from(financeMaintenanceCandidateItems)
          .where(eq(financeMaintenanceCandidateItems.id, setup.item.id)),
      ).resolves.toEqual([{ disposition: itemCase.disposition }]);
    }
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
  });
});
