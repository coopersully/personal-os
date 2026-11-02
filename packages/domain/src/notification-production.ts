import type { FinanceConversationEffectReceipt } from "./finance/conversation.js";
import type { FinanceHumanWorkRef } from "./finance/workflow-contracts.js";
import { localDateAt, localDateToIso } from "./time.js";

/**
 * Producer correlation only, never canonical ownership or execution evidence.
 * The owning API must reload the authenticated owner's current work/receipt before
 * enqueue and delivery. A digest, its delivery or nonresponse never approves work.
 */
export type NotificationProducerRef =
  | { kind: "human_work"; work: FinanceHumanWorkRef }
  | {
      kind: "action_receipt";
      receipt: Pick<FinanceConversationEffectReceipt, "id" | "committedAt" | "status">;
    };

export type NotificationReceiptCadence = "monthly" | "fortnightly";
export type NotificationReceiptPeriodInput =
  | { cadence: "monthly"; timeZone: string; asOf: Date }
  | {
      cadence: "fortnightly";
      timeZone: string;
      asOf: Date;
      /** Explicit local calendar anchor; fortnightly means fourteen local days. */
      anchorLocalDate: string;
    };
export type NotificationReceiptPeriod = {
  /** Scope with authenticated owner in persistence; this key alone is not globally unique. */
  key: string;
  cadence: NotificationReceiptCadence;
  timeZone: string;
  startLocalDate: string;
  endLocalDateExclusive: string;
};

/** Pure period identity; creates no preference, schedule, notification or approval. */
export function getNotificationReceiptPeriod(
  input: NotificationReceiptPeriodInput,
): NotificationReceiptPeriod {
  if (!Number.isFinite(input.asOf.getTime())) throw new RangeError("Invalid receipt clock.");
  const local = localDateAt(input.asOf, input.timeZone);
  let start = { ...local, day: 1 };
  let end = {
    year: local.month === 12 ? local.year + 1 : local.year,
    month: local.month === 12 ? 1 : local.month + 1,
    day: 1,
  };
  if (input.cadence === "fortnightly") {
    const anchor = input.anchorLocalDate;
    const anchorClock = new Date(`${anchor}T00:00:00.000Z`);
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(anchor) ||
      !Number.isFinite(anchorClock.getTime()) ||
      anchorClock.toISOString().slice(0, 10) !== anchor
    ) {
      throw new RangeError("Invalid local receipt anchor.");
    }
    // UTC here numbers calendar days; it does not measure elapsed owner-local hours.
    const localClock = new Date(`${localDateToIso(local)}T00:00:00.000Z`);
    const daysFromAnchor = (localClock.getTime() - anchorClock.getTime()) / 86_400_000;
    // Mutate a cloned actual calendar date: Date.UTC would reinterpret years 0–99 as 1900–1999.
    const startClock = new Date(anchorClock);
    startClock.setUTCDate(startClock.getUTCDate() + Math.floor(daysFromAnchor / 14) * 14);
    const endClock = new Date(startClock);
    endClock.setUTCDate(endClock.getUTCDate() + 14);
    start = {
      year: startClock.getUTCFullYear(),
      month: startClock.getUTCMonth() + 1,
      day: startClock.getUTCDate(),
    };
    end = {
      year: endClock.getUTCFullYear(),
      month: endClock.getUTCMonth() + 1,
      day: endClock.getUTCDate(),
    };
  }
  const startLocalDate = localDateToIso(start);
  const endLocalDateExclusive = localDateToIso(end);
  return {
    key: JSON.stringify([input.cadence, input.timeZone, startLocalDate, endLocalDateExclusive]),
    cadence: input.cadence,
    timeZone: input.timeZone,
    startLocalDate,
    endLocalDateExclusive,
  };
}
