type RuntimeWorkKind = "background" | "request";

export type RuntimeInFlight = {
  background: number;
  backgroundLabels: string[];
  requests: number;
};

export type RuntimeLifecycle = {
  beginQuiesce: (deadlineMs: number) => void;
  deadlineMs: () => number | undefined;
  inFlight: () => RuntimeInFlight;
  runRequest: <T>(operation: () => Promise<T>) => Promise<T> | undefined;
  signal: AbortSignal;
  startBackgroundTask: (label: string, operation: () => Promise<void>) => boolean;
  waitForIdle: () => Promise<void>;
};

export class RuntimeQuiesceError extends Error {
  public readonly deadlineMs: number;

  public constructor(deadlineMs: number) {
    super("The API runtime is quiescing.");
    this.name = "RuntimeQuiesceError";
    this.deadlineMs = deadlineMs;
  }
}

export class RuntimeDrainTimeoutError extends Error {
  public constructor(timeoutMs: number, active: RuntimeInFlight) {
    const labels = active.backgroundLabels.length > 0 ? active.backgroundLabels.join(", ") : "none";
    super(
      `API runtime did not quiesce within ${timeoutMs}ms (${active.requests} requests; background: ${labels}).`,
    );
    this.name = "RuntimeDrainTimeoutError";
  }
}

export class RuntimeDrainWorkError extends Error {
  public constructor(labels: string[]) {
    super(`API runtime drain observed rejected work: ${labels.join(", ")}.`);
    this.name = "RuntimeDrainWorkError";
  }
}

export function createRuntimeLifecycle(): RuntimeLifecycle {
  let accepting = true;
  let quiesceDeadlineMs: number | undefined;
  const quiesceController = new AbortController();
  const drainFailures = new Set<string>();
  const inFlight = new Map<Promise<unknown>, { kind: RuntimeWorkKind; label: string }>();

  function track<T>(kind: RuntimeWorkKind, label: string, operation: () => Promise<T>): Promise<T> {
    const work = Promise.resolve().then(operation);
    inFlight.set(work, { kind, label });
    work.then(
      () => inFlight.delete(work),
      (error: unknown) => {
        if (!accepting && error !== quiesceController.signal.reason) drainFailures.add(label);
        inFlight.delete(work);
      },
    );
    return work;
  }

  return {
    beginQuiesce(deadlineMs) {
      if (!accepting) return;
      accepting = false;
      quiesceDeadlineMs = deadlineMs;
      quiesceController.abort(new RuntimeQuiesceError(deadlineMs));
    },
    deadlineMs() {
      return quiesceDeadlineMs;
    },
    inFlight() {
      let background = 0;
      const backgroundLabels: string[] = [];
      let requests = 0;
      for (const work of inFlight.values()) {
        if (work.kind === "background") {
          background += 1;
          backgroundLabels.push(work.label);
        } else requests += 1;
      }
      return {
        background,
        backgroundLabels: [...new Set(backgroundLabels)].sort(),
        requests,
      };
    },
    runRequest<T>(operation: () => Promise<T>) {
      if (!accepting) return undefined;
      return track("request", "http-request", operation);
    },
    signal: quiesceController.signal,
    startBackgroundTask(label, operation) {
      if (!accepting) return false;
      void track("background", label, operation).catch(() => {
        // Callers own redacted failure observation. The lifecycle owns completion,
        // not provider error rendering.
      });
      return true;
    },
    async waitForIdle() {
      await Promise.allSettled([...inFlight.keys()]);
      if (drainFailures.size > 0) {
        throw new RuntimeDrainWorkError([...drainFailures].sort());
      }
    },
  };
}

export async function shutdownApiRuntime(options: {
  closeDatabase: () => Promise<void>;
  closeHttpServer: () => Promise<void>;
  lifecycle: RuntimeLifecycle;
  now?: () => number;
  stopScheduling: () => void;
  timeoutMs: number;
}): Promise<void> {
  const now = options.now ?? Date.now;
  options.lifecycle.beginQuiesce(now() + options.timeoutMs);
  options.stopScheduling();

  let deadlineExpired = false;
  let timeout: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      (async () => {
        await Promise.all([options.closeHttpServer(), options.lifecycle.waitForIdle()]);
        if (deadlineExpired) return;
        await options.closeDatabase();
      })(),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => {
          deadlineExpired = true;
          reject(new RuntimeDrainTimeoutError(options.timeoutMs, options.lifecycle.inFlight()));
        }, options.timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
