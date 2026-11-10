/** Serializes partial revisioned writes. A conflict blocks queued writes until reviewed recovery. */
export function createPreferenceQueue<T extends { revision: number; preferences: object }>(
  initial: T,
  write: (revision: number, patch: Partial<T["preferences"]>) => Promise<T>,
) {
  let current = initial;
  let blocked = false;
  let pending = 0;
  let version = 0;
  const listeners = new Set<() => void>();
  const notify = () => {
    version += 1;
    for (const listener of listeners) listener();
  };
  let queue: Promise<unknown> = Promise.resolve();
  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    snapshot: () => version,
    get current() {
      return current;
    },
    get pending() {
      return pending > 0;
    },
    get blocked() {
      return blocked;
    },
    save(patch: Partial<T["preferences"]>): Promise<T> {
      pending += 1;
      notify();
      const operation = queue.then(async () => {
        if (blocked) throw new Error("Refresh and review your changes before retrying.");
        try {
          current = await write(current.revision, patch);
          return current;
        } catch (error) {
          blocked = true;
          notify();
          throw error;
        }
      });
      void operation
        .finally(() => {
          pending -= 1;
          notify();
        })
        .catch(() => {});
      queue = operation.catch(() => {});
      return operation;
    },
    /** Call only after loading authoritative state and explicitly reviewing retained drafts. */
    recover(value: T) {
      if (pending)
        throw new Error("Wait for the current preference save to finish before reloading.");
      if (value.revision < current.revision)
        throw new Error("Preferences changed while reloading. Reload and review again.");
      current = value;
      blocked = false;
      notify();
    },
  };
}
