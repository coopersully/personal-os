import { describe, expect, it, vi } from "vitest";
import { createPreferenceQueue } from "./preferences";

describe("revisioned settings saves", () => {
  it("serializes distinct partial fields using the last accepted revision", async () => {
    const write = vi.fn(async (revision: number, patch: Partial<{ a: boolean; b: boolean }>) => ({
      revision: revision + 1,
      preferences: { a: false, b: false, ...patch },
    }));
    const queue = createPreferenceQueue(
      { revision: 4, preferences: { a: false, b: false } },
      write,
    );
    await Promise.all([queue.save({ a: true }), queue.save({ b: true })]);
    expect(write.mock.calls).toEqual([
      [4, { a: true }],
      [5, { b: true }],
    ]);
  });
  it("blocks queued retries after an uncertain result until explicit reviewed recovery", async () => {
    const write = vi
      .fn()
      .mockRejectedValueOnce(new Error("conflict"))
      .mockResolvedValue({ revision: 10, preferences: { a: true } });
    const queue = createPreferenceQueue({ revision: 1, preferences: { a: false } }, write);
    const first = queue.save({ a: true });
    const next = queue.save({ a: false });
    await expect(first).rejects.toThrow("conflict");
    await expect(next).rejects.toThrow("Refresh and review");
    expect(write).toHaveBeenCalledTimes(1);
    queue.recover({ revision: 9, preferences: { a: false } });
    await queue.save({ a: true });
    expect(write).toHaveBeenLastCalledWith(9, { a: true });
  });
});
