import type { Database } from "@personal-os/database";
import {
  guardFinanceExecutionTransaction,
  withFinanceExecutionOwner,
} from "./execution-owner-guard.js";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

it("rejects a caller-owned executor without the outer capability instead of opening a nested transaction", async () => {
  const db = { transaction: vi.fn() } as unknown as Database;
  const run = vi.fn();
  await expect(
    withFinanceExecutionOwner(db, "owner", {}, run, {} as Transaction),
  ).rejects.toMatchObject({ code: "internal_error" });
  expect(run).not.toHaveBeenCalled();
  expect(db.transaction).not.toHaveBeenCalled();
});
it("propagates the exact outer owner and prevents late token-plan widening", async () => {
  const chain = { from: vi.fn(), where: vi.fn(), for: vi.fn(async () => [{ id: "owner" }]) };
  chain.from.mockReturnValue(chain);
  chain.where.mockReturnValue(chain);
  const tx = { select: vi.fn(() => chain) } as unknown as Transaction;
  await guardFinanceExecutionTransaction(tx, "owner", {});
  expect(chain.for).toHaveBeenCalledWith("no key update");
  const db = { transaction: vi.fn() } as unknown as Database;
  const run = vi.fn(async (received) => received);
  expect(await withFinanceExecutionOwner(db, "owner", {}, run, tx)).toBe(tx);
  await expect(
    withFinanceExecutionOwner(
      db,
      "owner",
      { actorIds: ["11111111-1111-4111-8111-111111111111"] },
      run,
      tx,
    ),
  ).rejects.toMatchObject({ code: "conflict" });
  await expect(guardFinanceExecutionTransaction(tx, "foreign", {})).rejects.toMatchObject({
    code: "forbidden",
  });
  expect(run).toHaveBeenCalledTimes(1);
  expect(db.transaction).not.toHaveBeenCalled();
});
