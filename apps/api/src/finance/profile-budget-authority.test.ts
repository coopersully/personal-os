import type { Database } from "@personal-os/database";
import type { FinanceMutationContext } from "./context.js";
import { createProfileBudgetService } from "./profile-budget-service.js";

describe("budget approval identity", () => {
  it.each([
    false,
    true,
  ])("rejects an agent claiming user_instruction with bypass=%s", async (bypassEnabled) => {
    const context: FinanceMutationContext = {
      actorId: "agent",
      actorType: "agent",
      userId: "owner",
      canMutate: true,
      canSelfApprove: false,
      bypassEnabled,
      requestId: "forged-user-instruction",
    };
    const transaction = vi.fn(() => {
      throw new Error("Approval reached persistence");
    });
    const service = createProfileBudgetService({
      db: { transaction } as unknown as Database,
      now: () => new Date("2026-09-18T00:00:00Z"),
    });
    await expect(
      service.approveFinanceBudget(
        {
          approvalSource: "user_instruction",
          budgetVersionId: "00000000-0000-4000-8000-000000000001",
          expectedVersion: 1,
          idempotencyKey: "forged-approval",
        },
        context,
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(transaction).not.toHaveBeenCalled();
  });
});
