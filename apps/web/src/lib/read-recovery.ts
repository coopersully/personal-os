import { ApiClientError } from "@personal-os/api-client";
import { type Query, useQueryClient } from "@tanstack/react-query";
import { createContext, useEffect, useState } from "react";

export const ReadRecoveryContext = createContext<(error: unknown) => boolean>(() => false);

/** Permission/validation responses require their own correction, not an endless Retry gate. */
export function canRetryRead(error: unknown) {
  return (
    !(error instanceof ApiClientError) ||
    error.status === 408 ||
    error.status === 429 ||
    error.status >= 500
  );
}

export function useReadRecovery(enabled: boolean) {
  const client = useQueryClient();
  const [reads, setReads] = useState<Query[]>([]);
  useEffect(() => {
    if (!enabled) {
      setReads([]);
      return;
    }
    const cache = client.getQueryCache();
    const update = () =>
      setReads((previous) => {
        const all = cache.getAll();
        const retained = previous.filter(
          (query) =>
            all.includes(query) &&
            query.meta?.sessionIndependent !== true &&
            typeof query.options.queryFn === "function" &&
            query.state.status !== "success" &&
            canRetryRead(query.state.error),
        );
        for (const query of all) {
          if (
            query.queryKey[0] === "me" ||
            query.meta?.sessionIndependent === true ||
            typeof query.options.queryFn !== "function" ||
            !query.isActive() ||
            query.state.status !== "error" ||
            !canRetryRead(query.state.error)
          )
            continue;
          if (!retained.includes(query)) retained.push(query);
        }
        return retained.length === previous.length &&
          retained.every((query, index) => query === previous[index])
          ? previous
          : retained;
      });
    update();
    // Query observers can publish while another component is rendering. Reconcile after that
    // render rather than setting shell state synchronously from the cache notification.
    let active = true;
    let queued = false;
    const unsubscribe = cache.subscribe(() => {
      if (queued) return;
      queued = true;
      queueMicrotask(() => {
        queued = false;
        if (active) update();
      });
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [client, enabled]);
  return enabled ? reads : [];
}
