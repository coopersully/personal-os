import { AppError } from "./errors.js";
import { createFixedWindowRateLimiter } from "./rate-limit.js";

/** Process-wide backstop: reject excess work before database or provider I/O. */
export function createReadBudget(options: {
  concurrent: number;
  perUser: number;
  perMinute: number;
}) {
  const rate = createFixedWindowRateLimiter({ maxRequests: options.perMinute, windowMs: 60_000 });
  const users = new Map<string, number>();
  let active = 0;
  return async function run<T>(userId: string, operation: () => Promise<T>): Promise<T> {
    const count = users.get(userId) ?? 0;
    if (active >= options.concurrent || count >= options.perUser || !rate.check(userId).allowed)
      throw new AppError("rate_limited", "Too many requests. Try again shortly.");
    active += 1;
    users.set(userId, count + 1);
    try {
      return await operation();
    } finally {
      active -= 1;
      const remaining = (users.get(userId) ?? 1) - 1;
      if (remaining) users.set(userId, remaining);
      else users.delete(userId);
    }
  };
}

/** Search may supersede a read already running in SQL; wait without releasing its capacity early. */
export function createQueuedReadBudget(options: {
  concurrent: number;
  maxQueued: number;
  perMinute: number;
  maxWaitMs: number;
}) {
  const rate = createFixedWindowRateLimiter({ maxRequests: options.perMinute, windowMs: 60_000 });
  const activeUsers = new Set<string>();
  type Waiting = { start: () => void; cancel: (reason: unknown) => void };
  const waiting = new Map<string, Waiting>();
  const drain = () => {
    for (const [userId, entry] of waiting) {
      if (activeUsers.size >= options.concurrent) break;
      if (!activeUsers.has(userId)) entry.start();
    }
  };
  return async function run<T>(
    userId: string,
    operation: () => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    signal?.throwIfAborted();
    if (!rate.check(userId).allowed)
      throw new AppError("rate_limited", "Too many requests. Try again shortly.");
    await new Promise<void>((resolve, reject) => {
      const previous = waiting.get(userId);
      previous?.cancel(new AppError("conflict", "A newer search replaced this queued request."));
      if (!activeUsers.has(userId) && activeUsers.size < options.concurrent) {
        activeUsers.add(userId);
        resolve();
        return;
      }
      if (waiting.size >= options.maxQueued) {
        reject(new AppError("rate_limited", "Too many searches are waiting. Try again shortly."));
        return;
      }
      const cleanup = () => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
        waiting.delete(userId);
      };
      const entry: Waiting = {
        start: () => {
          cleanup();
          activeUsers.add(userId);
          resolve();
        },
        cancel: (reason) => {
          cleanup();
          reject(reason);
        },
      };
      const abort = () => entry.cancel(signal?.reason);
      const timer = setTimeout(
        () =>
          entry.cancel(new AppError("rate_limited", "Search is still busy. Try again shortly.")),
        options.maxWaitMs,
      );
      waiting.set(userId, entry);
      signal?.addEventListener("abort", abort, { once: true });
    });
    try {
      // The caller may have disconnected between admission and this microtask.
      signal?.throwIfAborted();
      return await operation();
    } finally {
      activeUsers.delete(userId);
      drain();
    }
  };
}

export const attachmentReadBudget = createReadBudget({ concurrent: 2, perUser: 1, perMinute: 30 });
export const workspaceSearchBudget = createQueuedReadBudget({
  concurrent: 2,
  maxQueued: 8,
  perMinute: 120,
  maxWaitMs: 6_000,
});
