import { type Database, financeConversationCapabilities } from "@personal-os/database";
import { FINANCE_CONVERSATION_PROTOCOL_VERSION } from "@personal-os/domain";
import { and, desc, eq, getTableColumns, sql } from "drizzle-orm";
import { AppError } from "../errors.js";
import { requireFinanceExecutionGuard } from "./execution-owner-guard.js";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
/** Select freshness BEFORE validity. A new unverified/expired generation supersedes every old proof. */
export async function getCurrentFinanceExecutionProof(
  tx: Transaction,
  ownerId: string,
  scheduleId: string,
  connectionId: string,
  protocolVersion = FINANCE_CONVERSATION_PROTOCOL_VERSION,
) {
  requireFinanceExecutionGuard(tx, ownerId);
  const [proof] = await tx
    .select({
      ...getTableColumns(financeConversationCapabilities),
      legacyTimestampCount: sql<string>`count(*) over(partition by ${financeConversationCapabilities.createdAt})::text`,
    })
    .from(financeConversationCapabilities)
    .where(
      and(
        eq(financeConversationCapabilities.userId, ownerId),
        eq(financeConversationCapabilities.automationScheduleId, scheduleId),
        eq(financeConversationCapabilities.authorizationConnectionId, connectionId),
        eq(financeConversationCapabilities.protocolVersion, protocolVersion),
      ),
    )
    .orderBy(
      sql`${financeConversationCapabilities.generation} DESC NULLS LAST`,
      desc(financeConversationCapabilities.createdAt),
    )
    .limit(1);
  if (!proof || (proof.generation === null && proof.legacyTimestampCount !== "1")) return null;
  return proof;
}
/** Caller retains the parent guard. Verified capability lifetime is unchanged. */
export async function requireCurrentFinanceExecutionProof(
  tx: Transaction,
  ownerId: string,
  scheduleId: string,
  connectionId: string,
  protocolVersion = FINANCE_CONVERSATION_PROTOCOL_VERSION,
) {
  const proof = await getCurrentFinanceExecutionProof(
    tx,
    ownerId,
    scheduleId,
    connectionId,
    protocolVersion,
  );
  if (!proof?.verifiedAt)
    throw new AppError("forbidden", "Verify the current original-host Finance message protocol.");
  return proof;
}

export function nextFinanceProofGeneration(previous: bigint | null): bigint {
  const generation = (previous ?? 0n) + 1n;
  if (generation <= 0n || generation > 9223372036854775807n)
    throw new AppError("conflict", "The Finance protocol challenge generation is exhausted.");
  return generation;
}
