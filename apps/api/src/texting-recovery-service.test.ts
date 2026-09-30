import type { Database } from "@personal-os/database";
import { createTextingRecoveryService } from "./texting-recovery-service.js";

describe("Texting recovery page boundary", () => {
  const service = createTextingRecoveryService({
    db: null as unknown as Database,
    enabled: () => true,
    finance: {
      inspectSmsReceipt: async () => ({ state: "absent" }),
      executeAnswer: async () => {
        throw new Error("not reached");
      },
    },
  });
  const owner = "11111111-1111-4111-8111-111111111111";

  it.each([
    0,
    26,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    1.5,
  ])("rejects invalid page limit %s before querying", async (limit) => {
    await expect(service.runPage(owner, { limit })).rejects.toThrow(
      "Invalid Texting recovery limit",
    );
  });

  it("rejects a malformed cursor before querying", async () => {
    await expect(
      service.runPage(owner, {
        limit: 1,
        after: { claimId: "not-a-uuid" },
      }),
    ).rejects.toThrow("Invalid Texting recovery cursor");
  });
});
