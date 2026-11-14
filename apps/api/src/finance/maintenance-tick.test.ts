import { runFinanceMaintenanceTick } from "./maintenance-tick.js";

function tick(overrides: Partial<Parameters<typeof runFinanceMaintenanceTick>[0]> = {}) {
  const order: string[] = [];
  const log = vi.fn();
  const dependencies = {
    recoverAcceptedWork: vi.fn(async () => {
      order.push("recover");
      return { failedRecoveries: 0 };
    }),
    dispatchDue: vi.fn(async () => {
      order.push("dispatch");
    }),
    processApprovedBatches: vi.fn(async () => {
      order.push("batches");
    }),
    log,
    ...overrides,
  };
  return { order, log, dependencies, run: () => runFinanceMaintenanceTick(dependencies) };
}

describe("Finance maintenance tick", () => {
  it("recovers and dispatches maintenance before approved batches run", async () => {
    const { order, log, run } = tick();
    await run();
    expect(order).toEqual(["recover", "dispatch", "batches"]);
    expect(log).not.toHaveBeenCalled();
  });

  it("still recovers and dispatches when approved-batch processing throws, and logs it", async () => {
    const { dependencies, log, run } = tick({
      processApprovedBatches: vi.fn(async () => {
        throw new Error("lock timeout with secret parameters");
      }),
    });
    await expect(run()).resolves.toBeUndefined();
    expect(dependencies.recoverAcceptedWork).toHaveBeenCalledTimes(1);
    expect(dependencies.dispatchDue).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "finance_approved_batch_failed",
        code: "finance_approved_batch_failed",
        status: 500,
      }),
    );
    expect(JSON.stringify(log.mock.calls)).not.toContain("secret");
  });

  it("reports failed maintenance recoveries after every step has run", async () => {
    const { order, run } = tick({
      recoverAcceptedWork: vi.fn(async () => ({ failedRecoveries: 2 })),
    });
    await expect(run()).rejects.toThrow("could not be recovered");
    expect(order).toEqual(["dispatch", "batches"]);
  });
});
