import { randomUUID } from "node:crypto";
import { financeReviewBatchRuns } from "@personal-os/database";
import { eq } from "drizzle-orm";
import { createMcpWorkspaceFixture } from "./fixture.js";

it("admits qualification through real HTTP with only Finance read scope and creates no preview", async () => {
  const f = await createMcpWorkspaceFixture();
  try {
    const reader = await f.connectAgent(["finances:read"]);
    const transactionId = randomUUID();
    const input = {
      decisions: [
        {
          kind: "categorization" as const,
          transactionId,
          categoryId: randomUUID(),
          expectedTransactionUpdatedAt: "2026-10-24T00:00:00.000Z",
          expectedTransactionRevision: "1",
          rationale: "Inspect only",
          evidence: "Not proof",
          confidence: 1,
          learnMerchant: "never" as const,
        },
      ],
    };
    const result = await reader.api.qualifyFinanceMaintenanceWork(input);
    await expect(
      reader.api.previewFinanceReviewBatch({ ...input, idempotencyKey: "must-not-write" }),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      reader.api.executeFinanceReviewBatch(randomUUID(), {
        fingerprint: `sha256:${"a".repeat(64)}`,
        limit: 1,
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(result.items).toEqual([
      {
        index: 0,
        transactionId,
        state: "authorization_denied",
        reasons: ["source_unavailable", "execution_not_authorized"],
        sourceRefs: [],
      },
    ]);
    expect(
      await f.db
        .select()
        .from(financeReviewBatchRuns)
        .where(eq(financeReviewBatchRuns.userId, f.owner.id)),
    ).toEqual([]);
  } finally {
    await f.close();
  }
}, 120_000);
