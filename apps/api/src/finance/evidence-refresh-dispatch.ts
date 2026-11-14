import type { Database } from "@personal-os/database";
import { sql } from "drizzle-orm";

/** The ordinary provider timer is independent; only accelerated claims consume this authority. */
export function pendingFinanceRefreshSql(at: Date) {
  return sql`SELECT req.id, req.actor_id, req.actor_type, tok.authorization_connection_id,
    ref->>'accountId' AS account_id, ref->>'accountRevision' AS account_revision, ref->>'providerAccountId' AS provider_account_id
    FROM finance_evidence_refresh_requests req
    CROSS JOIN LATERAL jsonb_array_elements(req.sources) ref
    JOIN finance_accounts account ON account.id::text = ref->>'accountId'
      AND account.user_id = req.user_id
    LEFT JOIN access_tokens tok ON tok.id::text = req.actor_id AND tok.user_id = req.user_id
    WHERE req.user_id = finance_provider_items.user_id AND req.result IS NULL
      AND req.requested_at <= ${at} AND req.requested_at >= ${new Date(at.getTime() - 86400000)}
      AND finance_provider_items.sync_state IN ('current','stale')
      AND (finance_provider_items.last_sync_attempt_at IS NULL OR finance_provider_items.last_sync_attempt_at < req.requested_at)
      AND ref->>'itemId' = finance_provider_items.id::text
      AND account.provider_item_record_id = finance_provider_items.id
      AND account.provider = 'plaid' AND account.status = 'connected'
      AND account.provider_item_id = finance_provider_items.provider_item_id
      AND account.provider_account_id = ref->>'providerAccountId'
      AND account.contextual_revision::text = ref->>'accountRevision'
      AND (req.actor_type = 'user' AND req.actor_id = req.user_id::text OR
        req.actor_type = 'agent' AND tok.revoked_at IS NULL AND tok.id IS NOT NULL
        AND (tok.expires_at IS NULL OR tok.expires_at > ${at})
        AND tok.scopes @> '["finances:read","finances:write","finances:maintain"]'::jsonb)
    ORDER BY req.requested_at, req.id LIMIT 1`;
}
export type FinanceRefreshDispatch = {
  id: string;
  actor_id: string;
  actor_type: "user" | "agent";
  authorization_connection_id: string | null;
  account_id: string;
  account_revision: string;
  provider_account_id: string;
};
export async function readFinanceRefreshDispatch(
  tx: Pick<Database, "execute">,
  userId: string,
  itemId: string,
  at: Date,
) {
  const result = await tx.execute<FinanceRefreshDispatch>(sql`
    SELECT request.* FROM finance_provider_items
    CROSS JOIN LATERAL (${pendingFinanceRefreshSql(at)}) request
    WHERE finance_provider_items.user_id = ${userId}::uuid AND finance_provider_items.id = ${itemId}::uuid
  `);
  return result.rows[0];
}
