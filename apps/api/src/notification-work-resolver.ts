import type { Database } from "@personal-os/database";
import type { FinanceHumanWorkRef, NotificationResolution } from "@personal-os/domain";

export type NotificationTransaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

/** The domain must lock its authoritative work until this transaction commits. A display label
 * is permitted only after domain disclosure policy; user preferences can only narrow it further.
 * This port neither grants authority nor accepts answers. Production has no producer in T0. */
export type NotificationWorkResolver = (
  userId: string,
  work: FinanceHumanWorkRef,
  transaction: NotificationTransaction,
) => Promise<NotificationResolution>;
