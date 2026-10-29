import {
  financeLedgerChallenges,
  financeMaintenanceCandidates,
  financePeriodReviews,
  workspaceMaintenanceRuns,
} from "@personal-os/database";
import { type FinanceLedgerChallengePage, financeLedgerChallengeChecks } from "@personal-os/domain";
import { eq } from "drizzle-orm";
import { createFinanceService } from "../../apps/api/src/finance-service.js";
import { createMcpWorkspaceFixture, type WorkspaceFixture } from "./fixture.js";

describe("persisted Finance maintenance packets through MCP", () => {
  let f: WorkspaceFixture;
  beforeAll(async () => {
    f = await createMcpWorkspaceFixture();
  }, 120_000);
  afterAll(async () => {
    await f?.close();
  });
  it("reads and submits the exact prepared packet, rejects stale coverage and preserves replay", async () => {
    const { client } = await f.connectAgent([
      "finances:read",
      "finances:write",
      "finances:maintain",
    ]);
    const finances = createFinanceService({
      db: f.db,
      now: () => new Date("2026-10-11T15:00:00Z"),
    });
    const scope = { type: "all_outstanding" as const };
    const snapshot = await finances.maintenanceCandidateSnapshot(f.owner.id, scope, [], null);
    const candidateId = crypto.randomUUID();
    const [run] = await f.db
      .insert(workspaceMaintenanceRuns)
      .values({
        userId: f.owner.id,
        domain: "finances",
        scope,
        rulebookVersion: "fixture",
        status: "awaiting_agent_challenge",
        checkpoint: { candidateId, phase: "challenge", revision: snapshot.revision },
      })
      .returning();
    await f.db.insert(financeMaintenanceCandidates).values({
      id: candidateId,
      userId: f.owner.id,
      runId: run!.id,
      revision: snapshot.revision,
      projection: snapshot.projection,
      state: "ready_for_challenge",
    });
    const [challenge] = await f.db
      .insert(financeLedgerChallenges)
      .values({
        userId: f.owner.id,
        runId: run!.id,
        candidateId,
        candidateRevision: snapshot.revision,
        cutoff: new Date("2026-10-11T15:00:00Z"),
        rubricVersion: "finance-ledger-challenge-v1",
      })
      .returning();
    const read = await client.callTool({
      name: "get_finance_ledger_challenge",
      arguments: { challengeId: challenge!.id },
    });
    expect(read.isError, JSON.stringify(read)).not.toBe(true);
    const page = (read.structuredContent as { result: FinanceLedgerChallengePage }).result;
    expect(page.items).toEqual([]);
    expect(page.nextCursor).toBeNull();
    expect(page.checks).toEqual(financeLedgerChallengeChecks);
    const input = {
      challengeId: page.challenge.id,
      candidateRevision: page.challenge.candidateRevision,
      rubricVersion: page.challenge.rubricVersion,
      checked: page.checks,
      reviewedItemIds: [],
      findings: [],
    };
    const stale = await client.callTool({
      name: "submit_finance_ledger_challenge",
      arguments: { ...input, candidateRevision: `sha256:${"0".repeat(64)}` },
    });
    expect(stale.isError).toBe(true);
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = await client.callTool({
        name: "submit_finance_ledger_challenge",
        arguments: input,
      });
      expect(result.isError, JSON.stringify(result)).not.toBe(true);
    }
    expect(
      await f.db.query.financeLedgerChallenges.findFirst({
        where: eq(financeLedgerChallenges.id, challenge!.id),
      }),
    ).toMatchObject({ state: "submitted" });
  });
  it("reads an immutable completed period report without substituting current workspace totals", async () => {
    const [run] = await f.db
      .insert(workspaceMaintenanceRuns)
      .values({
        userId: f.owner.id,
        domain: "finances",
        scope: { type: "all_outstanding" },
        rulebookVersion: "archived-fixture",
        status: "completed",
      })
      .returning();
    const [review] = await f.db
      .insert(financePeriodReviews)
      .values({
        userId: f.owner.id,
        runId: run!.id,
        periodStart: "2026-09-01",
        periodEnd: "2026-09-30",
        cutoff: new Date("2026-09-30T23:59:59Z"),
        status: "completed",
        report: {
          challenge: { checked: [...financeLedgerChallengeChecks], findings: 0, observations: 0 },
          closeReadiness: {
            missingProvenance: 0,
            possibleDuplicates: 0,
            ready: true,
            reconciledThrough: "2026-09-30",
            unansweredExceptions: 0,
            uncategorized: 0,
            unmatchedTransfers: 0,
          },
          income: 1000,
          goalsAndDebt: { activeGoals: 0, debt: 0, netWorth: 800 },
          monitoring: { href: "/finances", responsibility: "Review new transactions" },
          position: { cashLowPoint: 800, closing: 800, opening: 0 },
          recommendations: [],
          reimbursements: {
            anomalies: 0,
            expected: 0,
            needsInput: 0,
            open: 0,
            overdue: 0,
            outstanding: 0,
            received: 0,
            unresolved: 0,
            unmatchedCredits: 0,
          },
          spending: { budgetVariance: 0, gross: 200, personal: 200, savings: 800 },
          work: { approvals: 0, exceptions: 0, questions: 0, rulesAndActions: 0 },
        },
      })
      .returning();
    const { client } = await f.connectAgent(["finances:read"]);
    const result = await client.callTool({
      name: "get_finance_period_review",
      arguments: { reviewId: review!.id },
    });
    expect(result.isError, JSON.stringify(result)).not.toBe(true);
    expect(JSON.stringify(result.structuredContent)).toContain('"gross":200');
    expect(JSON.stringify(result.structuredContent)).toContain('"closing":800');
    expect(JSON.stringify(result.structuredContent)).toContain("2026-09-30");
  });
});
