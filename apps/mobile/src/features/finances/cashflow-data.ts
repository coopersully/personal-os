import { ApiClientError } from "@personal-os/api-client";
import { useQueryClient } from "@tanstack/react-query";
import { randomUUID } from "expo-crypto";
import { router } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner-native";
import type { RecurringItem, RecurringKind } from "./cashflow-rules";
import { useFinance, useFinanceRead } from "./data";
import { confirmedRejection, localToday } from "./mutations";

/** Opens a Cash flow page; `view` names it. */
export const cashflowPage = (view: string, params: Record<string, string> = {}) =>
  router.push({ pathname: "/finance-cashflow", params: { view, ...params } });

export const useRecurringItems = () =>
  useFinanceRead(["recurring-items"], (api) => api.listFinanceRecurringItems());
export const useRecurringSchedules = (enabled = true) =>
  useFinanceRead(["recurring-schedules"], (api) => api.listFinanceRecurringSchedules(), enabled);
export const useCashflowAccounts = () =>
  useFinanceRead(["accounts"], (api) => api.listFinanceAccounts());
export const useOccurrences = (range: { from: string; to: string } | null) =>
  useFinanceRead(
    ["upcoming", range],
    // Disabled without a range, so the read always has one.
    (api) => api.listFinanceRecurringOccurrences(range as { from: string; to: string }),
    !!range,
  );
export const useCashflowSources = (range: { from: string; to: string } | null) =>
  useFinanceRead(
    ["cashflow-sources", range],
    // Disabled without a range, so the read always has one.
    (api) => api.listFinanceCashflowSources(range as { from: string; to: string }),
    !!range,
  );

/** One recurring item by kind and id, with the account that gives its amounts a currency. */
export function useRecurringItem(kind: string | undefined, id: string | undefined) {
  const query = useRecurringItems();
  const accounts = useCashflowAccounts();
  const { timezone } = useFinance();
  const list: readonly RecurringItem[] | undefined =
    kind === "income"
      ? query.data?.data.income
      : kind === "obligation"
        ? query.data?.data.obligations
        : undefined;
  const item = list?.find((entry) => entry.id === id);
  const account = accounts.data?.accounts.find((entry) => entry.id === item?.accountId);
  return {
    query,
    accounts,
    item,
    kind: kind as RecurringKind,
    account,
    today: timezone ? localToday(timezone) : null,
    timezone,
  };
}

/**
 * True once a read has answered since this screen opened. A form states its write against the
 * revisions it opened with, so it must not open on a cached copy that is being re-read.
 */
export function useSettled(...queries: { data: unknown; isFetching: boolean }[]) {
  const [settled, setSettled] = useState(false);
  const ready = queries.every((query) => query.data !== undefined && !query.isFetching);
  useEffect(() => {
    if (ready) setSettled(true);
  }, [ready]);
  return settled;
}
/** A read shown as loading until `settled`, unless it has failed. */
export const until = <T extends { isPending: boolean; isError: boolean }>(
  query: T,
  settled: boolean,
): T => ({
  ...query,
  // A read that failed is shown as failed, with its retry, not as still loading.
  isPending: query.isPending || (!settled && !query.isError),
});

export interface WriteCopy<T = unknown> {
  loading: string;
  /** The confirmed result, in words; a function when it depends on what the server answered. */
  done: string | ((data: T) => string);
  /** The server answered 409: something this write depends on changed. */
  conflict: string;
  /** The server refused the write: nothing was changed. A function may add the server's reason. */
  rejected: string | ((error: ApiClientError) => string);
  /** No answer arrived: the write may or may not have been recorded. */
  unknown: string;
}

/**
 * Runs one Finance write under a single toast, from loading to the confirmed outcome. An
 * unanswered write keeps its key for the same payload, so sending it again cannot act twice;
 * Finance data is re-read before the outcome is reported, so nothing reads as saved early.
 */
export function useFinanceWrite() {
  const { owner } = useFinance();
  const client = useQueryClient();
  const [pending, setPending] = useState(false);
  // A re-read can fail without failing the write. Until it succeeds, what is on screen may
  // be the version the write replaced.
  const [unread, setUnread] = useState(false);
  const lock = useRef(false);
  const attempt = useRef<{ payload: string; key: string } | null>(null);
  const active = useRef(true);
  const currentOwner = useRef(owner);
  currentOwner.current = owner;
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);

  useEffect(() => {
    if (!unread) return;
    const cache = client.getQueryCache();
    const waiting = () =>
      cache
        .findAll({ queryKey: ["finances", owner], type: "active" })
        .some((query) => query.state.isInvalidated);
    if (!waiting()) return setUnread(false);
    return cache.subscribe(() => {
      if (!waiting()) setUnread(false);
    });
  }, [unread, client, owner]);

  async function run<T = unknown>(
    input: object,
    send: (idempotencyKey: string) => Promise<{
      outcome: string;
      data?: T;
      communication: { headline: string };
    }>,
    copy: WriteCopy<T>,
  ): Promise<boolean> {
    if (lock.current || !owner) return false;
    lock.current = true;
    setPending(true);
    const current = () => active.current && currentOwner.current === owner;
    const refresh = () => client.invalidateQueries({ queryKey: ["finances", owner] });
    const id = toast.loading(copy.loading);
    const gone = () => {
      toast.dismiss(id);
      return false;
    };
    const payload = JSON.stringify(input);
    if (attempt.current?.payload !== payload) attempt.current = { payload, key: randomUUID() };
    try {
      const result = await send(attempt.current.key);
      if (!current()) return gone();
      attempt.current = null;
      await refresh();
      if (!current()) return gone();
      if (result.outcome !== "completed") {
        if (result.outcome === "failed") toast.error(result.communication.headline, { id });
        else toast.info(result.communication.headline, { id });
        return false;
      }
      toast.success(typeof copy.done === "string" ? copy.done : copy.done(result.data as T), {
        id,
      });
      return true;
    } catch (error) {
      if (!current()) return gone();
      const rejected = confirmedRejection(error);
      if (rejected) attempt.current = null;
      // Rejected or unknown, what is on screen may be stale: re-read before the next attempt.
      await refresh();
      if (!current()) return gone();
      toast.error(
        error instanceof ApiClientError && error.status === 409
          ? copy.conflict
          : rejected
            ? typeof copy.rejected === "string"
              ? copy.rejected
              : copy.rejected(error)
            : copy.unknown,
        { id },
      );
      return false;
    } finally {
      lock.current = false;
      if (active.current) {
        setUnread(
          client
            .getQueryCache()
            .findAll({ queryKey: ["finances", owner], type: "active" })
            .some((query) => query.state.isInvalidated),
        );
        setPending(false);
      }
    }
  }
  return { pending, unread, run, locked: lock };
}
