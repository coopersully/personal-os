import { describe, expect, it, vi } from "vitest";
import { LatestAppearanceQueue } from "./appearance-preview";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
describe("appearance transport", () => {
  it("bounds work to one in flight and the newest pending value", async () => {
    const first = deferred();
    const delivered: number[] = [];
    const queue = new LatestAppearanceQueue<number>(async (value) => {
      if (value === 1) await first.promise;
      delivered.push(value);
    }, vi.fn());
    queue.submit(1);
    for (let i = 2; i <= 100; i++) queue.submit(i);
    expect(delivered).toEqual([]);
    first.resolve();
    await queue.flush();
    expect(delivered).toEqual([1, 100]);
  });
  it("drops queued work when the account or component is disposed", async () => {
    const first = deferred();
    const delivered: number[] = [];
    const queue = new LatestAppearanceQueue<number>(async (value) => {
      await first.promise;
      delivered.push(value);
    }, vi.fn());
    queue.submit(1);
    queue.submit(2);
    queue.dispose();
    queue.submit(3);
    first.resolve();
    await queue.flush();
    expect(delivered).toEqual([1]);
  });
  it("reports an error and still delivers the final value", async () => {
    const reported: unknown[] = [];
    const delivered: number[] = [];
    const queue = new LatestAppearanceQueue<number>(
      async (value) => {
        if (value === 1) throw new Error("offline");
        delivered.push(value);
      },
      (error) => reported.push(error),
    );
    queue.submit(1);
    queue.submit(2);
    await queue.flush();
    expect(delivered).toEqual([2]);
    expect(reported).toHaveLength(1);
  });
  it("recovers when the transport throws synchronously", async () => {
    const sent: number[] = [];
    const queue = new LatestAppearanceQueue<number>((value) => {
      if (value === 1) throw new Error("unavailable");
      sent.push(value);
      return Promise.resolve();
    }, vi.fn());
    queue.submit(1);
    await queue.flush();
    queue.submit(2);
    await queue.flush();
    expect(sent).toEqual([2]);
  });
});
