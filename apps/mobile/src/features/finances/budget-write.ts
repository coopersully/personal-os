import { ApiClientError } from "@personal-os/api-client";
import { useEffect, useRef } from "react";
import { useFinance } from "./data";
import { confirmedRejection } from "./mutations";

/**
 * What a failed budget write proves. Only `unknown` and `in_progress` may have written, so
 * only they keep the request's key for an identical retry.
 */
export type WriteFailure = "failed_before" | "in_progress" | "conflict" | "rejected" | "unknown";

export function writeFailure(error: unknown): WriteFailure {
  if (error instanceof ApiClientError && error.status === 409) {
    if (error.message.includes("previously failed")) return "failed_before";
    if (error.message.includes("already in progress")) return "in_progress";
    return "conflict";
  }
  return confirmedRejection(error) ? "rejected" : "unknown";
}

/** True while this screen is mounted for the person who opened it. */
export function useCurrentSession() {
  const { owner } = useFinance();
  const active = useRef(true);
  const latestOwner = useRef(owner);
  latestOwner.current = owner;
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  return () => active.current && latestOwner.current === owner;
}

/** The API's month value, or `undefined` when the text is not a real calendar month. */
export function budgetMonth(value: string | undefined): string | undefined {
  return value && /^\d{4}-(0[1-9]|1[0-2])$/.test(value) ? value : undefined;
}

export function monthName(month: string): string {
  return new Date(`${month}-01T12:00:00Z`).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** Whole cents for an exact amount with at most two decimals; `null` for anything else. */
export function amountCents(text: string): number | null {
  if (!/^\d+(\.\d{1,2})?$/.test(text.trim())) return null;
  const cents = Math.round(Number(text) * 100);
  return Number.isSafeInteger(cents) && cents <= 10_000_000_000 ? cents : null;
}
