import {
  closeNodeHttpServer,
  createRuntimeLifecycle,
  RuntimeDrainTimeoutError,
  RuntimeDrainWorkError,
  shutdownApiRuntime,
} from "./runtime-lifecycle.js";

function deferred(): {
  promise: Promise<void>;
  reject: (error: unknown) => void;
  resolve: () => void;
} {
  let reject: (error: unknown) => void = () => {};
  let resolve: () => void = () => {};
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    reject = rejectPromise;
    resolve = resolvePromise;
  });
  return { promise, reject, resolve };
}

describe("API runtime lifecycle", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("closes idle HTTP connections while waiting for active connections to drain", async () => {
    const closeIdleConnections = vi.fn();
    const server = {
      close: vi.fn((callback: (error?: Error) => void) => callback()),
      closeIdleConnections,
    };

    await closeNodeHttpServer(server as never);

    expect(server.close).toHaveBeenCalledOnce();
    expect(closeIdleConnections).toHaveBeenCalledOnce();
  });

  it("rejects new work after quiesce, publishes the deadline, and aborts accepted work", async () => {
    const lifecycle = createRuntimeLifecycle();
    const request = deferred();
    const background = deferred();

    const requestWork = lifecycle.runRequest(() => request.promise);
    expect(requestWork).toBeDefined();
    expect(
      lifecycle.startBackgroundTask("provider-effect", async () => {
        await background.promise;
      }),
    ).toBe(true);

    lifecycle.beginQuiesce(12_345);
    expect(lifecycle.deadlineMs()).toBe(12_345);
    expect(lifecycle.signal.aborted).toBe(true);
    expect(lifecycle.runRequest(async () => undefined)).toBeUndefined();
    expect(lifecycle.startBackgroundTask("late-claim", async () => undefined)).toBe(false);

    request.reject(lifecycle.signal.reason);
    background.reject(lifecycle.signal.reason);
    await lifecycle.waitForIdle();
    await expect(requestWork).rejects.toBe(lifecycle.signal.reason);
  });

  it("closes the database only after scheduling, HTTP, and tracked work drain", async () => {
    const lifecycle = createRuntimeLifecycle();
    const server = deferred();
    const order: string[] = [];
    lifecycle.runRequest(async () => {
      if (lifecycle.signal.aborted) throw lifecycle.signal.reason;
      await new Promise<void>((_resolve, reject) => {
        lifecycle.signal.addEventListener("abort", () => reject(lifecycle.signal.reason), {
          once: true,
        });
      });
    });

    const shutdown = shutdownApiRuntime({
      closeDatabase: async () => {
        order.push("database");
      },
      closeHttpServer: async () => {
        order.push("server-close-started");
        await server.promise;
      },
      lifecycle,
      now: () => 10_000,
      stopScheduling: () => order.push("scheduler-stopped"),
      timeoutMs: 1_000,
    });

    await Promise.resolve();
    expect(order).toEqual(["scheduler-stopped", "server-close-started"]);
    expect(lifecycle.deadlineMs()).toBe(11_000);
    expect(lifecycle.runRequest(async () => undefined)).toBeUndefined();

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
    lifecycle.startBackgroundTask("stuck-provider-effect", async () => {
      await providerEffect.promise;
    });
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
  });

  it("fails drain and preserves the database when non-quiesce work rejects", async () => {
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
