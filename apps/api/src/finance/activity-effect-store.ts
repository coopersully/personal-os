import {
  auditEvents,
  type Database,
  financeConversationEvidence,
  financeConversationMessages,
  financeMutationRecords,
} from "@personal-os/database";
import type { FinanceActivityQuery } from "@personal-os/domain";
import { and, desc, eq, inArray, lt, or, sql } from "drizzle-orm";
import { AppError } from "../errors.js";
import {
  decodeFinanceActivityEvidenceCursor,
  type FinanceActivityEffectSource,
  projectFinanceActivityEffect,
  projectFinanceActivityEvidence,
  readFinanceActivityReceipt,
} from "./activity-effects.js";

type Mutation = typeof financeMutationRecords.$inferSelect;
type Position = { at: string; id: string; kind?: "human_answer_decision" | "financial_action" };
export async function loadFinanceActivityEffectSource(
  db: Database,
  owner: string,
  mutation: Mutation,
  offset = 0,
): Promise<FinanceActivityEffectSource | null> {
  const receipt = readFinanceActivityReceipt(owner, mutation);
  if (!receipt) return null;
  const ids = receipt.auditEventIds.slice(offset, offset + 100);
  const audits = ids.length
    ? await db
        .select()
        .from(auditEvents)
        .where(
          and(
            eq(auditEvents.userId, owner),
            eq(auditEvents.requestId, receipt.requestId),
            inArray(auditEvents.id, ids),
          ),
        )
    : [];
  const messages = receipt.sourceMessageIds.length
    ? await db
        .select()
        .from(financeConversationMessages)
        .where(
          and(
            eq(financeConversationMessages.userId, owner),
            inArray(financeConversationMessages.id, receipt.sourceMessageIds),
          ),
        )
    : [];
  const [causalEvidence] = receipt.sourceMessageIds.length
    ? await db
        .select()
        .from(financeConversationEvidence)
        .where(
          and(
            eq(financeConversationEvidence.userId, owner),
            eq(financeConversationEvidence.runId, receipt.runId),
            eq(financeConversationEvidence.actionKey, mutation.idempotencyKey),
          ),
        )
    : [];
  return { mutation, receipt, audits, messages, causalEvidence: causalEvidence ?? null };
}
export async function listFinanceActivityEffects(
  db: Database,
  owner: string,
  query: FinanceActivityQuery,
  cursor: Position | null,
  secret: string,
) {
  const at = sql`(${financeMutationRecords.response}->'financeEffectReceipt'->>'committedAt')::timestamptz`;
  const rows = await db
    .select({
      mutation: financeMutationRecords,
      cursorAt: sql<string>`to_char(${at} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
    })
    .from(financeMutationRecords)
    .where(
      and(
        eq(financeMutationRecords.userId, owner),
        eq(financeMutationRecords.operation, "commit_finance_candidate_effect_v1"),
        eq(financeMutationRecords.status, "completed"),
        sql`${financeMutationRecords.response}->'financeEffectReceipt'->>'status' = 'applied'`,
        query.actor ? eq(financeMutationRecords.actorType, query.actor) : undefined,
        query.recordId
          ? sql`${financeMutationRecords.response}->'financeEffectReceipt'->'recordRefs' @> jsonb_build_array(jsonb_build_object('id',${query.recordId}::text))`
          : undefined,
        query.from ? sql`${at} >= ${query.from}::timestamptz` : undefined,
        query.through ? sql`${at} <= ${query.through}::timestamptz` : undefined,
        cursor
          ? or(
              sql`${at} < ${cursor.at}::timestamptz`,
              and(
                sql`${at} = ${cursor.at}::timestamptz`,
                or(
                  lt(financeMutationRecords.id, cursor.id),
                  cursor.kind === "human_answer_decision"
                    ? eq(financeMutationRecords.id, cursor.id)
                    : undefined,
                ),
              ),
            )
          : undefined,
      ),
    )
    .orderBy(desc(at), desc(financeMutationRecords.id))
    .limit(query.limit + 1);
  return Promise.all(
    rows.map(async (row) => {
      const source = await loadFinanceActivityEffectSource(db, owner, row.mutation);
      return {
        entry: source ? projectFinanceActivityEffect(owner, source, secret) : null,
        cursorAt: row.cursorAt,
        id: row.mutation.id,
        kind: "financial_action" as const,
      };
    }),
  );
}
export async function readFinanceActivityEvidence(
  db: Database,
  owner: string,
  id: string,
  cursor: string | undefined,
  secret: string,
) {
  const [mutation] = await db
    .select()
    .from(financeMutationRecords)
    .where(
      and(
        eq(financeMutationRecords.userId, owner),
        eq(financeMutationRecords.id, id),
        eq(financeMutationRecords.operation, "commit_finance_candidate_effect_v1"),
        eq(financeMutationRecords.status, "completed"),
      ),
    );
  const receipt = mutation ? readFinanceActivityReceipt(owner, mutation) : null;
  // Missing and foreign-owned receipts have the same response and expose no private identifiers.
  if (!mutation || !receipt) throw new AppError("not_found", "Activity evidence was not found.");
  const offset = decodeFinanceActivityEvidenceCursor(owner, receipt, cursor, secret);
  const source = await loadFinanceActivityEffectSource(db, owner, mutation, offset);
  const result = source ? projectFinanceActivityEvidence(owner, source, offset, secret) : null;
  if (!result) throw new AppError("not_found", "Activity evidence was not found.");
  return result;
}
