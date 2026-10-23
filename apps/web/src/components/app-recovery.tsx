import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { api } from "../api";
import { visibleConnectorRefreshInterval } from "../features/connections/health";
import {
  CONNECTION_SNOOZE_MS,
  connectionProblems,
  financeConnectionProblems,
  problemKey,
  readConnectionSnoozes,
} from "../features/connections/recovery-policy";
import { canRetryRead, ReadRecoveryContext, useReadRecovery } from "../lib/read-recovery";
import { ArrowRightIcon } from "./icons";
import { ModalRecoveryPriority } from "./modal-recovery-priority";
import { RecoverySurface } from "./recovery-surface";
import { Button } from "./ui/button";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemTitle } from "./ui/item";

export function AppRecovery({
  owner,
  accountBlocked,
  children,
}: {
  owner: string | undefined;
  accountBlocked: boolean;
  children: ReactNode;
}) {
  const previousOwner = useRef(owner);
  useEffect(() => {
    if (previousOwner.current && previousOwner.current !== owner) {
      try {
        sessionStorage.removeItem(
          `nohmi:connection-snooze:${window.location.origin}:${previousOwner.current}`,
        );
      } catch {
        /* No persistent state exists when storage is unavailable. */
      }
    }
    previousOwner.current = owner;
  }, [owner]);
  // Remount on owner changes: no identity can inherit another account's dialog or snooze.
  return owner ? (
    <SessionRecovery key={owner} owner={owner} accountBlocked={accountBlocked}>
      {children}
    </SessionRecovery>
  ) : (
    children
  );
}

function SessionRecovery({
  owner,
  accountBlocked,
  children,
}: {
  owner: string;
  accountBlocked: boolean;
  children: ReactNode;
}) {
  const client = useQueryClient();
  const navigate = useNavigate();
  const reads = useReadRecovery(true);
  const accounts = useQuery({
    queryKey: ["connectors"],
    queryFn: api.listConnectors,
    refetchOnMount: "always",
    refetchInterval: visibleConnectorRefreshInterval,
  });
  const finance = useQuery({
    queryKey: ["finance-accounts"],
    queryFn: () => api.listFinanceAccounts(),
    refetchOnMount: "always",
    refetchInterval: visibleConnectorRefreshInterval,
  });
  const storageKey = `nohmi:connection-snooze:${window.location.origin}:${owner}`;
  const [snoozes, setSnoozes] = useState(() => readConnectionSnoozes(storageKey));
  const [now, setNow] = useState(Date.now);
  const [retrying, setRetrying] = useState(false);
  const busy = useRef(false);
  const mounted = useRef(true);
  const handledErrors = useRef(new WeakSet<object>());
  const toastId = useId();
  const problems = [
    ...connectionProblems(accounts.data ?? []),
    ...financeConnectionProblems(finance.data?.accounts ?? []),
  ];
  const due = problems.filter((problem) => (snoozes[problemKey(problem)] ?? 0) <= now);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const expiry = Math.min(...Object.values(snoozes).filter((until) => until > now));
    const timer = Number.isFinite(expiry)
      ? window.setTimeout(tick, Math.max(0, expiry - Date.now()))
      : undefined;
    window.addEventListener("focus", tick);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("focus", tick);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [snoozes, now]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      toast.dismiss(toastId);
    };
  }, [toastId]);
  useEffect(() => {
    if (!reads.length) toast.dismiss(toastId);
  }, [reads.length, toastId]);
  function snooze() {
    const next = { ...snoozes };
    for (const problem of problems) next[problemKey(problem)] = Date.now() + CONNECTION_SNOOZE_MS;
    setSnoozes(next);
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      /* In-memory snooze still works when storage is unavailable. */
    }
  }
  useEffect(() => {
    const connectorsConfirmed = accounts.isSuccess && !accounts.isFetching;
    const financeConfirmed = finance.isSuccess && !finance.isFetching;
    if (!connectorsConfirmed && !financeConfirmed) return;
    const current = new Set(
      [
        ...connectionProblems(accounts.data ?? []),
        ...financeConnectionProblems(finance.data?.accounts ?? []),
      ].map(problemKey),
    );
    setSnoozes((previous) => {
      const next = Object.fromEntries(
        Object.entries(previous).filter(
          ([key]) =>
            current.has(key) ||
            (key.startsWith("connector:") && !connectorsConfirmed) ||
            (key.startsWith("finance:") && !financeConfirmed),
        ),
      );
      if (Object.keys(next).length === Object.keys(previous).length) return previous;
      try {
        sessionStorage.setItem(storageKey, JSON.stringify(next));
      } catch {
        /* Session memory remains authoritative. */
      }
      return next;
    });
  }, [
    accounts.data,
    accounts.isSuccess,
    accounts.isFetching,
    finance.data,
    finance.isSuccess,
    finance.isFetching,
    storageKey,
  ]);
  async function retry() {
    if (busy.current) return;
    busy.current = true;
    setRetrying(true);
    toast.loading("Trying again…", { id: toastId, position: "top-center" });
    const results = await Promise.allSettled(
      reads.map((query) =>
        query.fetch(undefined, {
          cancelRefetch: false,
          ...(query.state.fetchMeta ? { meta: query.state.fetchMeta } : {}),
        }),
      ),
    );
    if (!mounted.current) return;
    if (results.some((result) => result.status === "rejected"))
      toast.error("Couldn’t load your information. Try again.", {
        id: toastId,
        position: "top-center",
        duration: Number.POSITIVE_INFINITY,
      });
    else toast.dismiss(toastId);
    busy.current = false;
    setRetrying(false);
  }
  const surface = accountBlocked ? null : reads.length ? (
    <RecoverySurface
      open
      title="Let’s reconnect"
      description="Some information couldn’t load. Try again before continuing; your saved work stays in place."
      actions={
        <Button
          aria-disabled={retrying}
          aria-busy={retrying}
          className="aria-disabled:pointer-events-none aria-disabled:opacity-50"
          onClick={() => {
            void retry();
          }}
        >
          {retrying ? "Trying again…" : "Try again"}
        </Button>
      }
    />
  ) : (
    <RecoverySurface
      open={due.length > 0}
      title="Check your connections"
      description="Some connected information may be out of date. Review the affected accounts, or snooze this reminder for 15 minutes."
      actions={
        <>
          <Button variant="secondary" aria-label="Snooze for 15 minutes" onClick={snooze}>
            Snooze
          </Button>
          <Button
            onClick={() => {
              snooze();
              void navigate(due[0]?.href ?? "/settings?page=connections");
            }}
          >
            Review connections
          </Button>
        </>
      }
    >
      <ItemGroup className="max-h-64 overflow-y-auto">
        {due.map((problem) => (
          <Item key={problem.id} variant="muted" size="sm" asChild>
            <Link to={problem.href} onClick={snooze}>
              <ItemContent>
                <ItemTitle>{problem.label}</ItemTitle>
                <ItemDescription>
                  {problem.state === "reconnect"
                    ? "Reconnect this account to resume syncing."
                    : problem.state === "retrying"
                      ? "Sync is delayed. nohmi is retrying automatically."
                      : problem.state === "stale"
                        ? "Updates are out of date. Review this account’s sync status."
                        : "A service issue is preventing updates. Review its status."}
                </ItemDescription>
              </ItemContent>
              <ItemActions>
                <ArrowRightIcon aria-hidden="true" className="size-4" />
              </ItemActions>
            </Link>
          </Item>
        ))}
      </ItemGroup>
    </RecoverySurface>
  );
  const handlesError = (error: unknown) => {
    // Observers can retain the previous error for one render while a retry resets query state.
    // Keep that exact error owned by this session's gate instead of flashing a duplicate toast.
    if (error && typeof error === "object" && handledErrors.current.has(error)) return true;
    const handled =
      Boolean(error) &&
      canRetryRead(error) &&
      client
        .getQueryCache()
        .getAll()
        .some(
          (query) =>
            query.queryKey[0] !== "me" &&
            query.meta?.sessionIndependent !== true &&
            typeof query.options.queryFn === "function" &&
            query.isActive() &&
            query.state.error === error,
        );
    if (handled && error && typeof error === "object") handledErrors.current.add(error);
    return handled;
  };
  return (
    <ReadRecoveryContext.Provider value={handlesError}>
      <ModalRecoveryPriority.Provider value={accountBlocked || reads.length > 0 || due.length > 0}>
        {children}
        {surface}
      </ModalRecoveryPriority.Provider>
    </ReadRecoveryContext.Provider>
  );
}
