import type { Database } from "@personal-os/database";
import type { FinanceHumanWorkRef, NotificationResolution } from "@personal-os/domain";

export type NotificationTransaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

/** The domain resolves one ordered batch in the caller's transaction and holds authoritative
 * work locks through its commit. Results correspond positionally to the supplied references.
 * Disclosure policy belongs to the domain; preferences can only narrow it. This port neither
 * grants authority nor accepts answers. Production has no producer in T0. */
export type NotificationWorkResolver = (
  userId: string,
  work: FinanceHumanWorkRef[],
  transaction: NotificationTransaction,
) => Promise<NotificationResolution[]>;
