import { createRuntimeLifecycle, shutdownApiRuntime } from "./runtime-lifecycle.js";
import { createTextingRecoveryRuntime } from "./texting-recovery-runtime.js";

describe("Texting recovery runtime", () => {
  it("coalesces startup and tick, then rejects passes after quiesce while tracking the active pass", async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let calls = 0;
    const runtime = createTextingRecoveryRuntime(async () => {
      calls += 1;
      await held;
    });

    const startup = runtime.run();
    const tick = runtime.run();
    expect(startup).toBe(tick);
    await Promise.resolve();
    expect(calls).toBe(1);
    runtime.quiesce();
    expect(runtime.run()).toBeNull();
    release();
    await expect(startup).resolves.toBeUndefined();
    await expect(runtime.waitForIdle()).resolves.toBeUndefined();
    expect(calls).toBe(1);
  });

  it("keeps one startup/tick pass in the API drain until its write settles", async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let calls = 0;
    let databaseClosed = false;
    const recovery = createTextingRecoveryRuntime(async () => {
      calls += 1;
      await held;
    });
    const lifecycle = createRuntimeLifecycle();
    const invoke = async () => {
      const pass = recovery.run();
      if (pass) await pass;
    };
    expect(lifecycle.startBackgroundTask("startup-texting-recovery", invoke)).toBe(true);
    expect(lifecycle.startBackgroundTask("scheduled-texting-recovery", invoke)).toBe(true);
    await Promise.resolve();
    await Promise.resolve();
    expect(calls).toBe(1);
    expect(lifecycle.inFlight().background).toBe(2);

    const drain = shutdownApiRuntime({
      closeDatabase: async () => {
        databaseClosed = true;
      },
      closeHttpServer: async () => {},
      lifecycle,
      stopScheduling: recovery.quiesce,
      timeoutMs: 5_000,
    });
    expect(recovery.run()).toBeNull();
    expect(databaseClosed).toBe(false);
    release();
    await expect(drain).resolves.toBeUndefined();
    expect(databaseClosed).toBe(true);
    expect(lifecycle.inFlight().background).toBe(0);
  });
});
