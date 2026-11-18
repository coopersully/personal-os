import { ApiClientError } from "@personal-os/api-client";
import type {
  KnowledgeForgottenRecord,
  KnowledgeLifecycleInput,
  KnowledgeMutationResult,
  KnowledgeRecord,
} from "@personal-os/domain";
import { CancelledError, type QueryClient, useQueryClient } from "@tanstack/react-query";
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { api } from "@/api";
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

type LifecycleCopy = { pending: string; success: string; conflict: string };
const changedCopy = "This memory changed. Review the latest version.";

/** One loading toast per action, updated to the confirmed outcome. */
export function lifecycleCopy(input: KnowledgeLifecycleInput): LifecycleCopy {
  const copy = (pending: string, success: string, conflict = changedCopy) => ({
    pending,
    success,
    conflict,
  });
  switch (input.action) {
    case "revise":
      return copy("Saving memory…", "Memory saved.");
    case "confirm":
      return copy("Confirming memory…", "Memory confirmed.");
    case "dispute":
      return copy("Disputing memory…", "Memory disputed.");
    case "archive":
      return copy("Archiving memory…", "Memory archived.");
    case "unarchive":
      return copy("Unarchiving memory…", "Memory unarchived.");
    case "supersede":
      return copy("Replacing memory…", "Memory superseded.");
    case "restrict":
    case "widen":
      return copy("Updating workspace…", "Workspace updated.");
    case "raise_sensitivity":
      return copy("Updating sensitivity…", "Memory marked sensitive.");
    case "set_sensitivity":
      return copy(
        "Updating sensitivity…",
        input.sensitivity === "sensitive" ? "Memory marked sensitive." : "Memory marked standard.",
      );
    case "set_access":
      return copy(
        "Updating agent access…",
        input.agentAccess === "blocked"
          ? "Memory hidden from agents."
          : "Agents can read this memory.",
      );
    case "resolve_conflict":
      return copy(
        "Resolving conflict…",
        input.keep === "current" ? "Kept your version." : "Took the agent's version.",
      );
    case "trash":
      return copy("Moving memory to Trash…", "Memory moved to Trash.");
    case "restore":
      return copy(
        "Restoring memory…",
        "Memory restored.",
        "This memory couldn't be restored. Review Trash and try again.",
      );
    case "delete_now":
      return copy(
        "Deleting memory…",
        "Memory deleted.",
        "This memory's Trash state changed. Review it before deleting.",
      );
  }
}

/**
 * Runs one lifecycle action. A conflict (409) is never retried here: the caller refreshes and
 * the person decides again, so a stale Trash version or revision never applies on its own.
 */
export function updateMemory(
  actions: MemoryActions,
  input: KnowledgeLifecycleInput,
  handlers: {
    success?: string;
    done: (result: KnowledgeMutationResult) => void;
    /** Returns the toast to show instead of the action's conflict copy. */
    conflict: () => string | undefined;
  },
) {
  const copy = lifecycleCopy(input);
  // Trash and delete now return content-free receipts; anything else means it is gone.
  const expected =
    input.action === "trash" ? "trashed" : input.action === "delete_now" ? "forgotten" : "readable";
  return actions.run({
    pending: copy.pending,
    failure: "Couldn’t confirm this update. Review the latest memory before trying again.",
    request: () => api.updateKnowledge(input),
    complete: (result) => {
      handlers.done(result);
      return result.outcome === expected
        ? { message: handlers.success ?? copy.success }
        : { message: "This memory is unavailable.", tone: "info" };
    },
    recover: (error) => {
      if (memoryErrorStatus(error) !== 409) return undefined;
      return handlers.conflict() ?? copy.conflict;
    },
  });
}
