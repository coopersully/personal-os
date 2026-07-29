export const DEFAULT_API_SHUTDOWN_TIMEOUT_MS = 105_000;

type RuntimeWorkKind = "background" | "request";

export type RuntimeLifecycle = {
  beginQuiesce: () => void;
  inFlight: () => { background: number; requests: number };
  runRequest: <T>(operation: () => Promise<T>) => Promise<T> | undefined;
  startBackgroundTask: (label: string, operation: () => Promise<void>) => boolean;
  waitForIdle: () => Promise<void>;
};

export class RuntimeDrainTimeoutError extends Error {
  public constructor(timeoutMs: number) {
    super(`API runtime did not quiesce within ${timeoutMs}ms.`);
    this.name = "RuntimeDrainTimeoutError";
  }
}

export function createRuntimeLifecycle(): RuntimeLifecycle {
  let accepting = true;
  const inFlight = new Map<Promise<unknown>, RuntimeWorkKind>();

  function track<T>(kind: RuntimeWorkKind, operation: () => Promise<T>): Promise<T> {
    const work = Promise.resolve().then(operation);
    inFlight.set(work, kind);
    work.then(
      () => inFlight.delete(work),
      () => inFlight.delete(work),
    );
    return work;
  }

  return {
    beginQuiesce() {
      accepting = false;
    },
    inFlight() {
      let background = 0;
      let requests = 0;
      for (const kind of inFlight.values()) {
        if (kind === "background") background += 1;
        else requests += 1;
      }
      return { background, requests };
    },
    runRequest<T>(operation: () => Promise<T>) {
      if (!accepting) return undefined;
      return track("request", operation);
    },
    startBackgroundTask(_label, operation) {
      if (!accepting) return false;
      void track("background", operation).catch(() => {
        // Callers own redacted failure observation. The lifecycle owns completion,
        // not provider error rendering.
      });
      return true;
    },
    async waitForIdle() {
      await Promise.allSettled([...inFlight.keys()]);
    },
  };
}

export async function shutdownApiRuntime(options: {
  closeDatabase: () => Promise<void>;
  closeHttpServer: () => Promise<void>;
  lifecycle: RuntimeLifecycle;
  stopScheduling: () => void;
  timeoutMs: number;
}): Promise<void> {
  options.lifecycle.beginQuiesce();
  options.stopScheduling();

  let timeout: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      Promise.all([options.closeHttpServer(), options.lifecycle.waitForIdle()]),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new RuntimeDrainTimeoutError(options.timeoutMs)),
          options.timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }

  await options.closeDatabase();
}
