import {
  createRuntimeLifecycle,
  RuntimeDrainTimeoutError,
  RuntimeDrainWorkError,
  shutdownApiRuntime,
} from "./runtime-lifecycle.js";

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe("API runtime lifecycle", () => {
  it("rejects new work after quiesce and waits for accepted requests and background work", async () => {
    const lifecycle = createRuntimeLifecycle();
    const request = deferred();
    const background = deferred();

    const requestWork = lifecycle.runRequest(() => request.promise);
    expect(requestWork).toBeDefined();
    expect(lifecycle.startBackgroundTask("provider-effect", () => background.promise)).toBe(true);
    expect(lifecycle.inFlight()).toEqual({
      background: 1,
      backgroundLabels: ["provider-effect"],
      requests: 1,
    });

    lifecycle.beginQuiesce();
    expect(lifecycle.runRequest(async () => undefined)).toBeUndefined();
    expect(lifecycle.startBackgroundTask("late-claim", async () => undefined)).toBe(false);

    const idle = lifecycle.waitForIdle();
    let idleReached = false;
    void idle.then(() => {
      idleReached = true;
    });
    await Promise.resolve();
    expect(idleReached).toBe(false);

    request.resolve();
    background.resolve();
    await idle;
    await requestWork;
    expect(lifecycle.inFlight()).toEqual({
      background: 0,
      backgroundLabels: [],
      requests: 0,
    });
  });

  it("closes the database only after scheduling, HTTP, and tracked work drain", async () => {
    const lifecycle = createRuntimeLifecycle();
    const request = deferred();
    const server = deferred();
    const order: string[] = [];
    lifecycle.runRequest(() => request.promise);

    const shutdown = shutdownApiRuntime({
      closeDatabase: async () => {
        order.push("database");
      },
      closeHttpServer: async () => {
        order.push("server-close-started");
        await server.promise;
      },
      lifecycle,
      stopScheduling: () => order.push("scheduler-stopped"),
      timeoutMs: 1_000,
    });

    await Promise.resolve();
    expect(order).toEqual(["scheduler-stopped", "server-close-started"]);
    expect(lifecycle.runRequest(async () => undefined)).toBeUndefined();

    request.resolve();
    await Promise.resolve();
    expect(order).not.toContain("database");
    server.resolve();
    await shutdown;
    expect(order).toEqual(["scheduler-stopped", "server-close-started", "database"]);
  });

  it("fails without closing the database when the bounded drain expires", async () => {
    vi.useFakeTimers();
    const lifecycle = createRuntimeLifecycle();
    const providerEffect = deferred();
    const server = deferred();
    lifecycle.startBackgroundTask("stuck-provider-effect", () => providerEffect.promise);
    const closeDatabase = vi.fn(async () => undefined);

    const shutdown = shutdownApiRuntime({
      closeDatabase,
      closeHttpServer: () => server.promise,
      lifecycle,
      stopScheduling: () => undefined,
      timeoutMs: 1_000,
    });
    const assertion = expect(shutdown).rejects.toBeInstanceOf(RuntimeDrainTimeoutError);
    await vi.advanceTimersByTimeAsync(1_000);
    await assertion;
    expect(closeDatabase).not.toHaveBeenCalled();
    providerEffect.resolve();
    server.resolve();
    await vi.runAllTimersAsync();
    await Promise.resolve();
    expect(closeDatabase).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("applies the same deadline to database closure", async () => {
    vi.useFakeTimers();
    const lifecycle = createRuntimeLifecycle();
    const shutdown = shutdownApiRuntime({
      closeDatabase: () => new Promise(() => undefined),
      closeHttpServer: async () => undefined,
      lifecycle,
      stopScheduling: () => undefined,
      timeoutMs: 1_000,
    });
    const assertion = expect(shutdown).rejects.toThrow("1000ms (0 requests; background: none)");
    await vi.advanceTimersByTimeAsync(1_000);
    await assertion;
    vi.useRealTimers();
  });

  it("fails drain and preserves the database when accepted work rejects while quiescing", async () => {
    const lifecycle = createRuntimeLifecycle();
    const work = deferred();
    lifecycle.startBackgroundTask("provider-result-projection", async () => {
      await work.promise;
      throw new Error("sensitive provider failure");
    });
    const closeDatabase = vi.fn(async () => undefined);

    const shutdown = shutdownApiRuntime({
      closeDatabase,
      closeHttpServer: async () => undefined,
      lifecycle,
      stopScheduling: () => undefined,
      timeoutMs: 1_000,
    });
    work.resolve();

    await expect(shutdown).rejects.toEqual(
      new RuntimeDrainWorkError(["provider-result-projection"]),
    );
    expect(closeDatabase).not.toHaveBeenCalled();
  });
});
