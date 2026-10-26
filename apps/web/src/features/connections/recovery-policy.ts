import type { CalendarAccount } from "@personal-os/api-client";
import type { FinanceAccount } from "@personal-os/domain";
import { connectionHealth } from "./health";

export const CONNECTION_SNOOZE_MS = 15 * 60_000;

/** The server owns freshness: an old timestamp alone does not prove a failed connection. */
export function connectionProblems(accounts: CalendarAccount[]) {
  return accounts.flatMap((account) => {
    const states = [
      connectionHealth(account),
      ...(["calendar", "mail"] as const).flatMap((key) =>
        account[`${key}Enabled`] && account.capabilities?.[key]
          ? [account.capabilities[key].health]
          : [],
      ),
    ];
    const health =
      states.find((value) => value.state === "reconnect") ??
      states.find((value) => value.state === "service_attention") ??
      states.find((value) => value.state === "retrying");
    return health
      ? [
          {
            id: `connector:${account.id}`,
            label:
              account.label.trim() ||
              account.email ||
              (account.provider === "icloud"
                ? "Apple account"
                : account.provider === "google"
                  ? "Google account"
                  : "Connected account"),
            state: health.state,
            href: "/settings?page=connections",
          },
        ]
      : [];
  });
}

export function financeConnectionProblems(
  accounts: Array<Pick<FinanceAccount, "id" | "name" | "provider" | "status" | "synchronization">>,
) {
  return accounts.flatMap((account) => {
    if (account.provider === "manual" || account.status === "manual") return [];
    const state =
      account.status === "needs_reauth" || account.synchronization.recovery === "reconnect"
        ? "reconnect"
        : account.synchronization.state === "blocked"
          ? "service_attention"
          : account.synchronization.state === "retrying"
            ? "retrying"
            : account.synchronization.state === "stale"
              ? "stale"
              : null;
    return state
      ? [{ id: `finance:${account.id}`, label: account.name, state, href: "/finances/accounts" }]
      : [];
  });
}

export function readConnectionSnoozes(key: string): Record<string, number> {
  try {
    const value: unknown = JSON.parse(sessionStorage.getItem(key) ?? "{}");
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(
      Object.entries(value).filter(
        ([, until]) =>
          typeof until === "number" &&
          Number.isFinite(until) &&
          until <= Date.now() + CONNECTION_SNOOZE_MS,
      ),
    );
  } catch {
    return {};
  }
}

export const problemKey = (problem: { id: string; state: string }) =>
  `${problem.id}:${problem.state}`;
