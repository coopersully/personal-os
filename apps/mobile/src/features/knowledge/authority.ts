import { ApiClientError } from "@personal-os/api-client";
import type { KnowledgeForgottenRecord, KnowledgePage, KnowledgeRecord } from "@personal-os/domain";
import { randomUUID } from "expo-crypto";
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { toast } from "sonner-native";
import type { createSession } from "../auth/session";

export type MemoryApi = ReturnType<ReturnType<typeof createSession>["api"]>;
type Current = () => boolean;
export type MemoryAccess = {
  capture: () => Current;
  recover: (error: unknown, cursor?: boolean) => boolean;
  observe: (page: Pick<KnowledgePage, "epoch">) => boolean;
};
export function statusOf(error: unknown) {
  return error instanceof ApiClientError ? error.status : undefined;
}
/** The structured details of an API error, such as a 409's blocking merge IDs. */
export function detailsOf(error: unknown): Record<string, unknown> {
  const details = error instanceof ApiClientError ? error.details : undefined;
  return details && typeof details === "object" ? (details as Record<string, unknown>) : {};
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

export function useVisitAuthority(isSignedIn: Current) {
  const generation = useRef(0);
  const mounted = useRef(false);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      generation.current += 1;
    };
  }, []);
  const current = useCallback(() => mounted.current && isSignedIn(), [isSignedIn]);
  const capture = useCallback(() => {
    const version = generation.current;
    return () => current() && generation.current === version;
  }, [current]);
  const invalidate = useCallback(() => {
    generation.current += 1;
  }, []);
  return { current, capture, invalidate };
}

export type Feedback = {
  message: string;
  tone?: "success" | "error" | "info";
  description?: string;
};
type Command<T> = {
  loading: string;
  failure: string;
  request: (current: Current) => Promise<T>;
  complete: (result: T) => Feedback | undefined;
  rejected?: (error: unknown) => string | undefined;
  cursor?: boolean;
  /**
   * Hands the outcome toast to an owner that outlives this hook, for commands whose outcome
   * remounts the screen that ran them. Success and failure both go there.
   */
  retain?: (id: string, feedback: Feedback) => void;
};

export function useMemoryCommands(capture: () => Current, recover?: MemoryAccess["recover"]) {
  const active = useRef(false);
  const mounted = useRef(false);
  const version = useRef(0);
  const ids = useRef(new Set<string>());
  const [busy, setBusy] = useState(false);

  const cancel = useCallback(() => {
    version.current += 1;
    active.current = false;
    for (const id of ids.current) toast.dismiss(id);
    ids.current.clear();
  }, []);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      cancel();
    };
  }, [cancel]);

  const finish = useCallback((id: string, feedback: Feedback) => {
    const forgetId = () => ids.current.delete(id);
    ids.current.add(id);
    toast[feedback.tone ?? "success"](feedback.message, {
      id,
      description: feedback.description,
      onAutoClose: forgetId,
      onDismiss: forgetId,
    });
  }, []);

  async function run<T>({
    loading,
    failure,
    request,
    complete,
    rejected,
    cursor,
    retain,
  }: Command<T>) {
    const authorized = capture();
    const started = version.current;
    const current = () => mounted.current && authorized() && version.current === started;
    if (!current() || active.current) return;
    active.current = true;
    setBusy(true);
    const id = randomUUID();
    ids.current.add(id);
    toast.loading(loading, { id });
    try {
      const result = await request(current);
      if (!current()) return;
      const feedback = complete(result);
      if (feedback && retain) {
        ids.current.delete(id);
        retain(id, feedback);
      } else if (feedback) finish(id, feedback);
      else {
        toast.dismiss(id);
        ids.current.delete(id);
      }
    } catch (error) {
      if (!current() || recover?.(error, cursor)) return;
      const feedback: Feedback = { message: rejected?.(error) ?? failure, tone: "error" };
      if (retain) {
        ids.current.delete(id);
        retain(id, feedback);
      } else finish(id, feedback);
    } finally {
      if (version.current === started) {
        active.current = false;
        if (current()) setBusy(false);
      }
    }
  }

  /** Whether a command is running now, before its busy state has rendered. */
  const running = useCallback(() => active.current, []);
  return { busy, run, finish, running };
}

/**
 * A new memory keeps one key per body it submitted, so an uncertain save never duplicates it:
 * returning to an earlier entry after trying another replays the earlier one's receipt, and a
 * different body always gets a different key.
 */
export function useMutationKey() {
  const keys = useRef(new Map<string, string>());
  return (body: unknown) => {
    const serialized = JSON.stringify(body);
    let key = keys.current.get(serialized);
    if (!key) {
      key = randomUUID();
      keys.current.set(serialized, key);
    }
    return key;
  };
}

/** Private reads are held only in the mounted screen. Both result and error paths check
 * cancellation before inspecting the response or requesting an authority reset. */
export async function readMemory<T>(
  access: MemoryAccess,
  signal: AbortSignal,
  request: () => Promise<T>,
  options?: { cursor?: boolean; epoch?: (result: T) => number },
) {
  const current = access.capture();
  try {
    const value = await request();
    if (signal.aborted || !current()) return;
    if (options?.epoch && !access.observe({ epoch: options.epoch(value) })) return;
    if (current()) return value;
  } catch (error) {
    if (signal.aborted || !current() || access.recover(error, options?.cursor)) return;
    throw error;
  }
}

type Resource<T> = { value?: T; loading: boolean; failed?: boolean };
export function useMemoryResource<T>(load: (signal: AbortSignal) => Promise<T | undefined>) {
  const [state, setState] = useState<Resource<T>>({ loading: true });
  const active = useRef<AbortController>(null);
  const reload = useCallback(async () => {
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    setState({ loading: true });
    try {
      const value = await load(controller.signal);
      if (!controller.signal.aborted && value !== undefined) setState({ value, loading: false });
      return value;
    } catch (error) {
      if (controller.signal.aborted) return;
      setState({ loading: false, failed: true });
      throw error;
    }
  }, [load]);
  /**
   * Pull-to-refresh: keeps what is shown and lets the caller report a failure once. `accept` is
   * asked when the result arrives, so work that started meanwhile (an edit, a write) can keep
   * what it is based on.
   */
  const refresh = useCallback(
    async (accept?: () => boolean) => {
      active.current?.abort();
      const controller = new AbortController();
      active.current = controller;
      try {
        const value = await load(controller.signal);
        if (!controller.signal.aborted && value !== undefined && (accept?.() ?? true))
          setState({ value, loading: false });
        return value;
      } catch (error) {
        // A newer read replaced this one, so its failure is not the person's to hear about.
        if (controller.signal.aborted) return;
        throw error;
      }
    },
    [load],
  );
  useLayoutEffect(() => {
    void reload().catch(() => {});
    return () => active.current?.abort();
  }, [reload]);
  return { ...state, reload, refresh };
}
