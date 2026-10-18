import type { Database } from "@personal-os/database";
import {
  type ReconcileFinanceReimbursementInput,
  reconcileFinanceReimbursementInputSchema,
} from "@personal-os/domain";
import { createFinanceReimbursementService } from "./finance-reimbursement-service.js";
import type { Principal } from "./types.js";

const owner = "00000000-0000-4000-8000-000000000001";
const input: ReconcileFinanceReimbursementInput = {
  operation: "unmatch_credit" as const,
  reimbursementId: owner,
  matchId: owner,
  expectedRevision: 1,
  idempotencyKey: "retry-key-123",
  rationale: "Wrong receipt",
  evidence: {
    sourceRefs: [
      {
        provider: "local",
        sourceType: "finance_transaction",
        accountId: null,
        remoteId: null,
        revision: null,
      },
    ],
    summary: "I reviewed this credit.",
  },
};
describe("Explicit reimbursement correction admission", () => {
  it.each([
    "agent",
    "foreign-user",
  ])("rejects %s before any database or completed-receipt lookup", async (kind) => {
    const db = new Proxy(
      {},
      {
        get() {
          throw new Error("Database accessed before authority guard");
        },
      },
    ) as Database;
    const principal: Principal = {
      actorId: "another-actor",
      actorType: kind === "agent" ? "agent" : "user",
      userId: owner,
      scopes: new Set(["finances:write"]),
    };
    await expect(
      createFinanceReimbursementService({ db, now: () => new Date() }).reconcile(input, {
        principal,
        requestId: "guard",
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
  });
  it("requires bounded correction evidence, source version and stable retry key", () => {
    const valid = reconcileFinanceReimbursementInputSchema.safeParse(input);
    expect(valid.success).toBe(true);
    expect(
      reconcileFinanceReimbursementInputSchema.safeParse({ ...input, expectedRevision: 0 }).success,
    ).toBe(false);
    expect(
      reconcileFinanceReimbursementInputSchema.safeParse({ ...input, idempotencyKey: "" }).success,
    ).toBe(false);
    expect(
      reconcileFinanceReimbursementInputSchema.safeParse({
        ...input,
        evidence: { summary: "Unsupported", sourceRefs: [] },
      }).success,
    ).toBe(false);
  });
});
