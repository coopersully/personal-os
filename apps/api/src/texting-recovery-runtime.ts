/** Coalesce startup and tick invocations; quiesce fences new work and retains the current promise. */
export function createTextingRecoveryRuntime<T>(
  dispatch: (shouldContinue: () => boolean) => Promise<T>,
) {
  let active: Promise<T> | null = null;
  let accepting = true;
  return {
    run(): Promise<T> | null {
      if (!accepting) return null;
      if (active) return active;
      const work = Promise.resolve().then(() => dispatch(() => accepting));
      active = work;
      void work
        .finally(() => {
          if (active === work) active = null;
        })
        .catch(() => {
          // The caller observes the original promise. This continuation only releases singleflight.
        });
      return work;
    },
    quiesce(): void {
      accepting = false;
    },
    async waitForIdle(): Promise<void> {
      if (active) await active;
    },
  };
}
