import { type Database, textInboundClaims, textReplyBindings } from "@personal-os/database";
import { and, asc, eq, exists, gt, inArray, notExists, or } from "drizzle-orm";
import type { createTextingRecoveryService } from "./texting-recovery-service.js";

type ClaimKey = { userId: string; claimId: string };
type Recovery = Pick<ReturnType<typeof createTextingRecoveryService>, "recoverClaim">;
const UNFINISHED = ["pending", "waiting", "uncertain"] as const;
const MAX_CLAIMS_PER_PASS = 25;

/** One local rotating scan. Every candidate is rechecked by the owner-scoped recovery service. */
export function createTextingRecoveryDispatcher(options: { db: Database; recovery: Recovery }) {
  let cursor: ClaimKey | null = null;

  async function scan(after: ClaimKey | null): Promise<ClaimKey[]> {
    const attached = options.db
      .select({ id: textReplyBindings.id })
      .from(textReplyBindings)
      .where(
        and(
          eq(textReplyBindings.userId, textInboundClaims.userId),
          eq(textReplyBindings.inboundClaimId, textInboundClaims.id),
        ),
      );
    const unfinished = options.db
      .select({ id: textReplyBindings.id })
      .from(textReplyBindings)
      .where(
        and(
          eq(textReplyBindings.userId, textInboundClaims.userId),
          eq(textReplyBindings.inboundClaimId, textInboundClaims.id),
          inArray(textReplyBindings.state, UNFINISHED),
        ),
      );
    const rows = await options.db
      .select({ userId: textInboundClaims.userId, claimId: textInboundClaims.id })
      .from(textInboundClaims)
      .where(
        and(
          or(notExists(attached), exists(unfinished)),
          after
            ? or(
                gt(textInboundClaims.userId, after.userId),
                and(
                  eq(textInboundClaims.userId, after.userId),
                  gt(textInboundClaims.id, after.claimId),
                ),
              )
            : undefined,
        ),
      )
      .orderBy(asc(textInboundClaims.userId), asc(textInboundClaims.id))
      .limit(MAX_CLAIMS_PER_PASS);
    return rows;
  }

  return {
    async runPass(
      input: { shouldContinue?: () => boolean } = {},
    ): Promise<{ attempted: number; failed: number }> {
      const shouldContinue = input.shouldContinue ?? (() => true);
      if (!shouldContinue()) return { attempted: 0, failed: 0 };
      let candidates = await scan(cursor);
      if (!candidates.length && cursor && shouldContinue()) candidates = await scan(null);
      let failed = 0;
      let attempted = 0;
      for (const key of candidates) {
        if (!shouldContinue()) break;
        attempted += 1;
        try {
          await options.recovery.recoverClaim(key.userId, key.claimId);
        } catch {
          failed += 1;
        } finally {
          // A failed claim remains eligible, but cannot starve following owners.
          cursor = key;
        }
      }
      return { attempted, failed };
    },
  };
}
