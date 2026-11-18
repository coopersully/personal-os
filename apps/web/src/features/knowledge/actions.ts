import { ApiClientError } from "@personal-os/api-client";
import type { KnowledgeForgottenRecord, KnowledgeRecord } from "@personal-os/domain";
import { CancelledError, type QueryClient, useQueryClient } from "@tanstack/react-query";
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  type PreferenceSession,
  registerSessionCleanup,
  sameSession,
} from "../workspace-settings/account-save-session";

export const memoryKey = ["memory"] as const;
const registered = new WeakSet<QueryClient>();

export function registerMemoryCleanup(client: QueryClient) {
  if (registered.has(client)) return;
  registered.add(client);
  registerSessionCleanup(client, () => client.removeQueries({ queryKey: memoryKey }));
}

type Outcome = {
  message: string;
  tone?: "success" | "info" | "error";
  description?: string;
  persistent?: boolean;
};
type RunOptions<T> = {
  pending: string;
  failure: string;
  request: (isCurrent: () => boolean) => Promise<T>;
  complete: (result: T, toastId: string) => Outcome | undefined;
  recover?: (error: unknown) => string | undefined;
};

export function memoryErrorStatus(error: unknown) {
  return error instanceof ApiClientError ? error.status : undefined;
}

/** The Memory screen treats a purged record like any other record that is no longer available. */
export function readableMemory(result: KnowledgeRecord | KnowledgeForgottenRecord) {
  if ("state" in result)
    throw new ApiClientError({
      code: "not_found",
      message: "This memory was deleted.",
      status: 404,
    });
  return result;
}

type ContentAuthority = {
  canPublish: () => boolean;
  onRevalidate: () => void;
};

// Keep private command inputs out of the mutation cache and Sonner messages.
// Every callback that can publish content, write a file or show a toast is fenced.
export function useMemoryActions(
  { owner, epoch }: PreferenceSession,
  authority?: ContentAuthority,
) {
  const client = useQueryClient();
  const mounted = useRef(false);
  const pending = useRef(false);
  const version = useRef(0);
  const toastIds = useRef(new Set<string>());
  const [busy, setBusy] = useState(false);
  const isCurrent = useCallback(
    () => mounted.current && sameSession(client, { owner, epoch }),
    [client, owner, epoch],
  );
  useLayoutEffect(() => {
    mounted.current = true;
    const ids = toastIds.current;
    return () => {
      mounted.current = false;
      for (const id of ids) toast.dismiss(id);
      ids.clear();
    };
  }, []);

  const invalidate = useCallback((keepToast?: string) => {
    version.current += 1;
    pending.current = false;
    setBusy(false);
    for (const id of toastIds.current) {
      if (id === keepToast) continue;
      toast.dismiss(id);
      toastIds.current.delete(id);
    }
  }, []);

  function captureAuthority() {
    const captured = version.current;
    return () => isCurrent() && captured === version.current && (authority?.canPublish() ?? true);
  }

  async function read<T>(request: () => Promise<T>, cursor?: string): Promise<T> {
    const isAuthorized = captureAuthority();
    try {
      const result = await request();
      if (!isAuthorized()) throw new CancelledError({ silent: true });
      return result;
    } catch (error) {
      if (!isAuthorized()) throw new CancelledError({ silent: true });
      // A continuation conflict can mean previously disclosed records have been withdrawn.
      if (cursor && authority && memoryErrorStatus(error) === 409) {
        invalidate();
        authority.onRevalidate();
        throw new CancelledError({ silent: true });
      }
      throw error;
    }
  }

  function notifyError(message: string) {
    if (!captureAuthority()()) return;
    const id = crypto.randomUUID();
    toastIds.current.add(id);
    toast.error(message, { id, onAutoClose: () => toastIds.current.delete(id) });
  }

  const finishToast = useCallback(
    (id: string, outcome: Outcome) => {
      if (!isCurrent()) return;
      toastIds.current.add(id);
      const onClose = () => toastIds.current.delete(id);
      toast[outcome.tone ?? "success"](outcome.message, {
        id,
        onAutoClose: onClose,
        onDismiss: onClose,
        description: outcome.description,
        duration: outcome.persistent ? Number.POSITIVE_INFINITY : 4000,
      });
    },
    [isCurrent],
  );

  async function run<T>({ pending: loading, failure, request, complete, recover }: RunOptions<T>) {
    const isAuthorized = captureAuthority();
    const started = version.current;
    if (pending.current || !isAuthorized()) return;
    pending.current = true;
    setBusy(true);
    const id = crypto.randomUUID();
    const onClose = () => toastIds.current.delete(id);
    toastIds.current.add(id);
    toast.loading(loading, { id, onDismiss: onClose });
    try {
      const result = await request(isAuthorized);
      if (!isAuthorized()) return;
      const outcome = complete(result, id);
      if (outcome) {
        finishToast(id, outcome);
      } else {
        toast.dismiss(id);
      }
    } catch (error) {
      if (!isAuthorized()) return;
      const message = recover?.(error) ?? failure;
      finishToast(id, { message, tone: "error" });
    } finally {
      if (started === version.current) {
        pending.current = false;
        if (isCurrent()) setBusy(false);
      }
    }
  }

  return { busy, finishToast, invalidate, isCurrent, notifyError, read, run };
}

export type MemoryActions = ReturnType<typeof useMemoryActions>;

/** Exact retries reuse the receipt key; changing content or revision creates a new command. */
export function useMemoryWriteKey() {
  const previous = useRef<{ payload: string; mutationKey: string } | null>(null);
  return function retryableInput<T extends { mutationKey: string }>(input: T): T {
    const { mutationKey, ...body } = input;
    const payload = JSON.stringify(body);
    if (previous.current?.payload !== payload) previous.current = { payload, mutationKey };
    return { ...input, mutationKey: previous.current.mutationKey };
  };
}
