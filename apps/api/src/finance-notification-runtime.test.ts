import { runFinanceReconciliationStages } from "./finance-notification-runtime.js";
import {
  FinanceClaimReconciliationError,
  financeReconciliationDiagnostic,
} from "./finance-reconciliation-errors.js";

it("runs all phases and retains safe stage/count evidence without provider text", async () => {
  const order: string[] = [];
  let failure: unknown;
  try {
    await runFinanceReconciliationStages([
      {
        name: "context",
        run: async () => {
          order.push("context");
          throw new FinanceClaimReconciliationError(4);
        },
      },
      {
        name: "acknowledgement",
        run: async () => {
          order.push("ack");
        },
      },
      {
        name: "host",
        run: async () => {
          order.push("host");
          throw new Error("private transport token");
        },
      },
      {
        name: "notification",
        run: async () => {
          order.push("notification");
          return { failed: 3 };
        },
      },
    ]);
  } catch (error) {
    failure = error;
  }
  expect(failure).toBeInstanceOf(Error);
  expect((failure as Error).message).toBe("Finance reconciliation failed for 8 operations.");
  expect(JSON.parse(financeReconciliationDiagnostic(failure))).toEqual([
    { stage: "context", code: "stage_failed", count: 4 },
    { stage: "host", code: "stage_failed", count: 1 },
    { stage: "notification", code: "operations_failed", count: 3 },
  ]);
  expect(financeReconciliationDiagnostic(new Error("private token"))).toBe(
    "unclassified_stage_failure",
  );
  expect(order).toEqual(["context", "ack", "host", "notification"]);
});

it("completes a healthy pass and preserves shutdown fences", async () => {
  let running = true;
  const later = vi.fn();
  await expect(
    runFinanceReconciliationStages([
      {
        name: "context",
        run: async () => {
          running = false;
        },
      },
      {
        name: "host",
        run: async () => {
          if (running) later();
        },
      },
      { name: "notification", run: async () => ({ failed: 0 }) },
    ]),
  ).resolves.toBeUndefined();
  expect(later).not.toHaveBeenCalled();
});

it("ignores malformed returned counts and safely classifies invalid thrown counts while later stages run", async () => {
  for (const result of [
    null,
    "private response",
    {},
    { failed: "4" },
    { failed: -1 },
    { failed: Number.NaN },
    { failed: Number.MAX_SAFE_INTEGER + 1 },
  ]) {
    await expect(
      runFinanceReconciliationStages([{ name: "context", run: async () => result }]),
    ).resolves.toBeUndefined();
  }
  for (const count of [-1, 0, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
    const later = vi.fn(async () => undefined);
    const error = await runFinanceReconciliationStages([
      {
        name: "context",
        run: async () => {
          throw new FinanceClaimReconciliationError(count);
        },
      },
      { name: "host", run: later },
    ]).catch((error) => error);
    expect(JSON.parse(financeReconciliationDiagnostic(error))).toEqual([
      { stage: "context", code: "stage_failed", count: 1 },
    ]);
    expect(later).toHaveBeenCalledTimes(1);
  }
});
