import { ApiClientError } from "@personal-os/api-client";
import { type MailThreadSummary, mailThreadSummarySchema } from "@personal-os/domain";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { AppState } from "react-native";
import { toast } from "sonner-native";
import { useAuth } from "../auth/context";
import { MAIL_PAGE_SIZE, type MailScope, nextMailPage, planningZone, scopeTarget } from "./logic";

/** Mail reads own their feedback, so the shared read-error toast stays out of the way. */
const meta = { scopedReadFeedback: true };

/** One read settles and throws when it failed, so pull-to-refresh can report it once. */
export async function confirmMailRead(read: Promise<{ isError: boolean }>) {
  if ((await read).isError) throw new Error("Mail read failed");
}

/** An explicit "Try again": one toast from loading to the confirmed outcome. */
export async function retryMailRead(read: () => Promise<{ isError: boolean }>) {
  const id = "mail-read-retry";
  toast.loading("Loading mail…", { id });
  try {
    await confirmMailRead(read());
    toast.success("Mail loaded", { id });
  } catch {
    toast.error("Couldn’t load mail. Check your connection and try again.", { id });
  }
}

/** The signed-in person's Mail: their API, their id, and the time zone their days are read in. */
export function useMail() {
  const { session, state } = useAuth();
  return {
    api: session.api(),
    owner: state.user?.id,
    timeZone: planningZone(state.user?.planningTimezone),
  };
}

/**
 * Body-free thread summaries for one scope. Search runs on the server so it covers mail that has
 * not been paged in; typing is debounced and each search keeps its own pages.
 */
export function useMailThreads(scope: MailScope, search: string) {
  const { api, owner } = useMail();
  const typed = search.trim();
  const [query, setQuery] = useState(typed);
  useEffect(() => {
    const timer = setTimeout(() => setQuery(typed), 250);
    return () => clearTimeout(timer);
  }, [typed]);
  const target = scopeTarget(scope);
  const threads = useInfiniteQuery({
    queryKey: ["mail", owner, "summaries", target, query],
    meta,
    enabled: !!owner,
    initialPageParam: undefined as ReturnType<typeof nextMailPage>,
    queryFn: ({ pageParam }) =>
      api.listMailThreadSummaries({
        ...(scope.kind === "inbox"
          ? { mailboxRole: "inbox" as const }
          : scope.kind === "snoozed"
            ? { snoozed: true }
            : { mailboxId: scope.mailboxId }),
        limit: MAIL_PAGE_SIZE,
        ...(query ? { query } : {}),
        ...pageParam,
      }),
    getNextPageParam: nextMailPage,
  });
  // Covers the typing pause and the server read, so a search never looks idle while in flight.
  const searching =
    typed !== query || (!!query && threads.isFetching && !threads.isFetchingNextPage);
  return { threads, query, searching };
}

/** Connected Mail accounts with their mailboxes and unread counts. */
export function useMailAccounts() {
  const { api, owner } = useMail();
  return useQuery({
    queryKey: ["mail", owner, "accounts"],
    meta,
    enabled: !!owner,
    queryFn: async () => (await api.getMailSetupContext()).accounts,
  });
}

/**
 * Message bodies are read on demand and held only while the reader is open: no cache time, so
 * closing the reader discards them and nothing but summaries outlives a screen.
 */
export function useMailMessages(threadId: string) {
  const { api, owner } = useMail();
  return useQuery({
    queryKey: ["mail", owner, "messages", threadId],
    meta,
    enabled: !!owner,
    queryFn: () => api.listMailMessages(threadId),
    gcTime: 0,
    staleTime: 0,
  });
}

/** Open Mail attention items, as Today reads them. `enabled` keeps other mailboxes from asking. */
export function useMailAttention(enabled = true) {
  const { api, owner } = useMail();
  return useQuery({
    queryKey: ["mail", owner, "attention"],
    meta,
    enabled: enabled && !!owner,
    queryFn: () => api.listAttentionItems({ domain: "mail", status: "open", limit: 100 }),
  });
}

/**
 * The findings reads made for an action that reports its own outcome, by cached query. Each is
 * known by the query's failure count: `after` is the count when the read began, and `failure`
 * the count of the failure that read itself ended in (`null` when it ended in none), unset while
 * the read is in flight.
 */
const ownedReads = new WeakMap<object, { after: number; failure?: number | null }[]>();

/**
 * What the steward recorded about one conversation. It quotes the conversation, so like the
 * messages it is held only while the reader is open. `failedAt` is set while a failed read is
 * still unreported; `reread` reads again for an action that reports the outcome itself (an
 * answer, a pull), so a failure there never raises a second toast.
 */
export function useMailStewardship(threadId: string) {
  const { api, owner } = useMail();
  const client = useQueryClient();
  const queryKey = ["mail", owner, "stewardship", threadId];
  const query = useQuery({
    queryKey,
    meta,
    enabled: !!owner,
    queryFn: () => api.getMailThreadStewardship(threadId),
    gcTime: 0,
    staleTime: 0,
  });
  const cached = client.getQueryCache().find({ queryKey, exact: true });
  const reread = async () => {
    const owned: { after: number; failure?: number | null } = {
      after: cached?.state.errorUpdateCount ?? query.errorUpdateCount,
    };
    if (cached) ownedReads.set(cached, [...(ownedReads.get(cached) ?? []), owned]);
    let failure: number | null = null;
    try {
      const read = await query.refetch();
      if (read.isError && read.errorUpdateCount > owned.after) failure = read.errorUpdateCount;
      return read;
    } finally {
      owned.failure = failure;
    }
  };
  const failures = query.errorUpdateCount;
  // A query has one fetch at a time, so a failure that lands while the read is in flight is its
  // own. Once it settles, exactly the failure it ended in stays silent: a later read that fails
  // is reported, however soon after.
  const owned =
    cached &&
    ownedReads
      .get(cached)
      ?.some((read) =>
        read.failure === undefined ? failures > read.after : read.failure === failures,
      );
  const at = query.errorUpdatedAt;
  return { ...query, reread, failedAt: query.isError && !owned ? at : 0 };
}

/**
 * Reads one conversation the list has not loaded, as a body-free summary: the reader loads the
 * message text itself. One toast covers the wait and is dismissed once the conversation opens.
 */
export function useMailThreadRead() {
  const { api, owner } = useMail();
  const { session } = useAuth();
  return async (id: string): Promise<MailThreadSummary | null> => {
    const toastId = `mail-open-${owner}`;
    const epoch = session.epoch();
    toast.loading("Opening conversation…", { id: toastId });
    try {
      const thread = mailThreadSummarySchema.parse(await api.getMailThread(id));
      toast.dismiss(toastId);
      // A conversation that arrives after the account changed belongs to nobody on screen.
      return session.epoch() === epoch ? thread : null;
    } catch (error) {
      if (session.epoch() !== epoch) toast.dismiss(toastId);
      else if (error instanceof ApiClientError && error.status === 404)
        toast.error("This conversation is no longer available.", { id: toastId });
      else
        toast.error("Couldn’t open this conversation. Check your connection and try again.", {
          id: toastId,
        });
      return null;
    }
  };
}

/** Native tabs stay mounted; revalidate stale Mail reads on return and on foreground. */
export function useMailRevalidation() {
  const { owner } = useMail();
  const client = useQueryClient();
  useFocusEffect(
    useCallback(() => {
      if (!owner) return;
      const refresh = () => {
        void client.refetchQueries({ queryKey: ["mail", owner], type: "active", stale: true });
      };
      refresh();
      const listener = AppState.addEventListener("change", (status) => {
        if (status === "active") refresh();
      });
      return () => listener.remove();
    }, [client, owner]),
  );
}
