import { accessTokens, oauthRefreshTokens } from "@personal-os/database";
import { and, gt, isNull, or, sql } from "drizzle-orm";

/** Background host eligibility follows a live connection grant, not only the
 * short-lived bearer. Incoming agent requests still require a valid access token. */
export function activeHostConnectionGrant(now: Date) {
  return and(
    isNull(accessTokens.revokedAt),
    or(
      isNull(accessTokens.expiresAt),
      gt(accessTokens.expiresAt, now),
      sql`EXISTS (
        SELECT 1 FROM ${oauthRefreshTokens}
        WHERE ${oauthRefreshTokens.accessTokenId} = ${accessTokens.id}
          AND ${oauthRefreshTokens.userId} = ${accessTokens.userId}
          AND ${oauthRefreshTokens.clientId} = ${accessTokens.clientId}
          AND ${accessTokens.audience} IS NOT NULL
          AND ${oauthRefreshTokens.replacedAt} IS NULL
          AND ${oauthRefreshTokens.expiresAt} > ${now}
      )`,
    ),
  );
}
