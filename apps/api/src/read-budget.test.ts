import { createQueuedReadBudget, createReadBudget } from "./read-budget.js";

it("rejects concurrent work before I/O and releases capacity on success and error", async () => {
  const run = createReadBudget({ concurrent: 2, perUser: 1, perMinute: 20 });
  let finish!: () => void;
  const first = run(
    "one",
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const operation = vi.fn(async () => "ok");
  await expect(run("one", operation)).rejects.toMatchObject({ status: 429 });
  let fail!: (error: Error) => void;
  const second = run(
    "two",
    () =>
      new Promise<void>((_resolve, reject) => {
        fail = reject;
      }),
  );
  await expect(run("three", operation)).rejects.toMatchObject({ status: 429 });
  expect(operation).not.toHaveBeenCalled();
  fail(new Error("Provider down"));
  await expect(second).rejects.toThrow("Provider down");
  expect(await run("two", operation)).toBe("ok");
  finish();
  await first;
  expect(await run("one", operation)).toBe("ok");
});
it("limits sequential reads per user and resets the time window", async () => {
  vi.useFakeTimers();
  try {
    const run = createReadBudget({ concurrent: 2, perUser: 2, perMinute: 1 });
    await run("one", async () => {});
    await expect(run("one", async () => {})).rejects.toMatchObject({ status: 429 });
    await run("two", async () => {});
    vi.advanceTimersByTime(60_000);
    await expect(run("one", async () => 3)).resolves.toBe(3);
  } finally {
    vi.useRealTimers();
  }
});
it("keeps the remaining same-user request counted when one finishes", async () => {
  const run = createReadBudget({ concurrent: 3, perUser: 2, perMinute: 20 });
  let finish!: () => void;
  const pending = run(
    "one",
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  await run("one", async () => {});
  await run("one", async () => {});
  finish();
  await pending;
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const queuedOptions = { concurrent: 2, maxQueued: 2, perMinute: 20, maxWaitMs: 6000 };
it("waits for aborted active SQL to settle before starting the latest same-user search", async () => {
  const run = createQueuedReadBudget(queuedOptions);
  const old = deferred<string>();
  const started = deferred<void>();
  const caller = new AbortController();
  const first = run(
    "one",
    () => {
      started.resolve();
      return old.promise;
    },
    caller.signal,
  );
  await started.promise;
  caller.abort();
  const replacement = vi.fn(async () => "latest");
  const second = run("one", replacement);
  await run("two", async () => "independent");
  expect(replacement).not.toHaveBeenCalled();
  old.resolve("old SQL settled");
  await expect(first).resolves.toBe("old SQL settled");
  await expect(second).resolves.toBe("latest");
  expect(replacement).toHaveBeenCalledOnce();
});
it("aborts stale queued requests and coalesces each user's remaining waiter", async () => {
  const run = createQueuedReadBudget(queuedOptions);
  const active = deferred<void>();
  const first = run("one", () => active.promise);
  const stale = vi.fn(async () => "stale");
  const aborted = new AbortController();
  const abandoned = run("one", stale, aborted.signal);
  const abandonedResult = expect(abandoned).rejects.toMatchObject({ name: "AbortError" });
  aborted.abort();
  await abandonedResult;
  const replaced = run("one", stale);
  const replacedResult = expect(replaced).rejects.toMatchObject({ code: "conflict" });
  const latest = run("one", async () => "latest");
  await replacedResult;
  active.resolve();
  await first;
  expect(await latest).toBe("latest");
  expect(stale).not.toHaveBeenCalled();
});
it("bounds global queued work and keeps active errors from stranding waiters", async () => {
  const run = createQueuedReadBudget({ ...queuedOptions, maxQueued: 1 });
  const one = deferred<void>();
  const two = deferred<void>();
  const first = run("one", () => one.promise);
  const firstResult = expect(first).rejects.toThrow("SQL failed");
  const second = run("two", () => two.promise);
  const waiting = vi.fn(async () => "admitted");
  const third = run("three", waiting);
  await expect(run("four", vi.fn())).rejects.toMatchObject({ status: 429 });
  expect(waiting).not.toHaveBeenCalled();
  one.reject(new Error("SQL failed"));
  await firstResult;
  expect(await third).toBe("admitted");
  two.resolve();
  await second;
});
it("expires bounded waiters without freeing a still-running SQL operation", async () => {
  vi.useFakeTimers();
  try {
    const run = createQueuedReadBudget({ ...queuedOptions, concurrent: 1 });
    const active = deferred<void>();
    const first = run("one", () => active.promise);
    const next = vi.fn(async () => "next");
    const queued = run("one", next);
    const rejected = expect(queued).rejects.toMatchObject({ status: 429 });
    await vi.advanceTimersByTimeAsync(6000);
    await rejected;
    expect(next).not.toHaveBeenCalled();
    const retry = run("one", next);
    active.resolve();
    await first;
    expect(await retry).toBe("next");
  } finally {
    vi.useRealTimers();
  }
});
it("rejects pre-aborted and rate-limited searches before starting work", async () => {
  const run = createQueuedReadBudget({ ...queuedOptions, perMinute: 1 });
  const operation = vi.fn(async () => "ok");
  const controller = new AbortController();
  controller.abort();
  await expect(run("one", operation, controller.signal)).rejects.toMatchObject({
    name: "AbortError",
  });
  expect(operation).not.toHaveBeenCalled();
  expect(await run("one", operation)).toBe("ok");
  await expect(run("one", operation)).rejects.toMatchObject({ status: 429 });
  expect(operation).toHaveBeenCalledOnce();
});
