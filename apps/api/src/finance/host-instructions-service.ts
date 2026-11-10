import {
  automationHostSchedules,
  type Database,
  financeHostInstructionReceipts,
} from "@personal-os/database";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { AppError } from "../errors.js";
import type { Principal } from "../types.js";
import { requireWorkspaceExecution } from "../workspace-execution.js";
import {
  FINANCE_HOST_INSTRUCTION_VERSION,
  renderFinanceHostInstructions,
} from "./automation-prompts.js";
import { guardFinanceExecutionTransaction } from "./execution-owner-guard.js";
import { getCurrentFinanceExecutionProof } from "./execution-proof.js";
import { requireHostRunAuthority } from "./host-run-authority.js";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Receipt = typeof financeHostInstructionReceipts.$inferSelect;
const value = (row: Receipt) => ({
  receiptId: row.id,
  scheduleId: row.scheduleId,
  authorizationConnectionId: row.authorizationConnectionId,
  actorId: row.actorId,
  operationId: row.operationId,
  scheduleVersion: row.scheduleVersion,
  instructionVersion: row.instructionVersion,
  text: row.text,
  servedAt: row.servedAt.toISOString(),
  acknowledgedAt: row.acknowledgedAt?.toISOString() ?? null,
});
export async function readFinanceHostInstructionSummary(
  tx: Pick<Database, "select">,
  userId: string,
  scheduleId: string,
) {
  const [served] = await tx
    .select()
    .from(financeHostInstructionReceipts)
    .where(
      and(
        eq(financeHostInstructionReceipts.userId, userId),
        eq(financeHostInstructionReceipts.scheduleId, scheduleId),
      ),
    )
    .orderBy(desc(financeHostInstructionReceipts.servedAt), desc(financeHostInstructionReceipts.id))
    .limit(1);
  const [acknowledged] = await tx
    .select()
    .from(financeHostInstructionReceipts)
    .where(
      and(
        eq(financeHostInstructionReceipts.userId, userId),
        eq(financeHostInstructionReceipts.scheduleId, scheduleId),
        sql`${financeHostInstructionReceipts.acknowledgedAt} IS NOT NULL`,
      ),
    )
    .orderBy(
      desc(financeHostInstructionReceipts.acknowledgedAt),
      desc(financeHostInstructionReceipts.id),
    )
    .limit(1);
  const summary = (row: Receipt | undefined) =>
    row
      ? {
          receiptId: row.id,
          instructionVersion: row.instructionVersion,
          scheduleVersion: row.scheduleVersion,
          servedAt: row.servedAt.toISOString(),
          acknowledgedAt: row.acknowledgedAt?.toISOString() ?? null,
        }
      : null;
  return {
    currentVersion: FINANCE_HOST_INSTRUCTION_VERSION,
    latestServed: summary(served),
    latestAcknowledged: summary(acknowledged),
    acknowledgementMeaning: "host_reported_adoption_not_proof_of_obedience" as const,
  };
}
export function createFinanceHostInstructionService({
  db,
  now,
}: {
  db: Database;
  now: () => Date;
}) {
  async function authority(tx: Transaction, principal: Principal, scheduleId: string) {
    await guardFinanceExecutionTransaction(tx, principal.userId, {
      actorIds: principal.actorType === "agent" ? [principal.actorId] : [],
      connectionIds: principal.authorizationConnectionId
        ? [principal.authorizationConnectionId]
        : [],
      hostSchedules: true,
    });
    const [row] = await tx
      .select()
      .from(automationHostSchedules)
      .where(
        and(
          eq(automationHostSchedules.userId, principal.userId),
          eq(automationHostSchedules.id, scheduleId),
        ),
      )
      .for("share");
    if (!row) throw new AppError("not_found", "The Finance host registration was not found.");
    await requireHostRunAuthority(
      tx,
      {
        userId: row.userId,
        automationScheduleId: row.id,
        authorizationConnectionId: row.authorizationConnectionId,
      },
      principal,
      now(),
    );
    await requireWorkspaceExecution(tx, principal, "finances", now());
    return row;
  }
  return {
    async loadInstructions(principal: Principal, scheduleId: string, raw: unknown) {
      const input = z.object({ operationId: z.uuid() }).strict().parse(raw);
      return db.transaction(async (tx) => {
        const host = await authority(tx, principal, scheduleId);
        const [existing] = await tx
          .select()
          .from(financeHostInstructionReceipts)
          .where(
            and(
              eq(financeHostInstructionReceipts.userId, principal.userId),
              eq(financeHostInstructionReceipts.scheduleId, scheduleId),
              eq(financeHostInstructionReceipts.operationId, input.operationId),
            ),
          );
        if (
          existing &&
          (existing.actorId !== principal.actorId ||
            existing.authorizationConnectionId !== host.authorizationConnectionId)
        )
          throw new AppError(
            "conflict",
            "Retry this instruction load through its original credential.",
          );
        const [receipt] = existing
          ? [existing]
          : await tx
              .insert(financeHostInstructionReceipts)
              .values({
                userId: principal.userId,
                scheduleId,
                authorizationConnectionId: host.authorizationConnectionId,
                actorId: principal.actorId,
                operationId: input.operationId,
                scheduleVersion: host.schedule.version,
                instructionVersion: FINANCE_HOST_INSTRUCTION_VERSION,
                text: renderFinanceHostInstructions(host.schedule),
                servedAt: now(),
              })
              .returning();
        if (!receipt)
          throw new AppError("internal_error", "The instruction receipt was not saved.");
        const proof = await getCurrentFinanceExecutionProof(
          tx,
          principal.userId,
          scheduleId,
          host.authorizationConnectionId,
        );
        return {
          ...value(receipt),
          pendingChallengeId:
            proof && !proof.verifiedAt && proof.expiresAt > now() ? proof.id : null,
        };
      });
    },
    async acknowledgeInstructions(principal: Principal, scheduleId: string, raw: unknown) {
      const input = z
        .object({ receiptId: z.uuid(), instructionVersion: z.int().positive() })
        .strict()
        .parse(raw);
      return db.transaction(async (tx) => {
        const host = await authority(tx, principal, scheduleId);
        const [receipt] = await tx
          .select()
          .from(financeHostInstructionReceipts)
          .where(
            and(
              eq(financeHostInstructionReceipts.userId, principal.userId),
              eq(financeHostInstructionReceipts.scheduleId, scheduleId),
              eq(financeHostInstructionReceipts.id, input.receiptId),
            ),
          )
          .for("update");
        if (!receipt) throw new AppError("not_found", "The instruction receipt was not found.");
        if (
          receipt.actorId !== principal.actorId ||
          receipt.authorizationConnectionId !== host.authorizationConnectionId ||
          receipt.scheduleVersion !== host.schedule.version ||
          receipt.instructionVersion !== input.instructionVersion ||
          receipt.instructionVersion !== FINANCE_HOST_INSTRUCTION_VERSION
        )
          throw new AppError(
            "conflict",
            "Reload current instructions after a credential, schedule or instruction change.",
          );
        if (receipt.acknowledgedAt) return value(receipt);
        const [acknowledged] = await tx
          .update(financeHostInstructionReceipts)
          .set({ acknowledgedAt: now() })
          .where(eq(financeHostInstructionReceipts.id, receipt.id))
          .returning();
        if (!acknowledged) throw new AppError("conflict", "The instruction receipt changed.");
        return value(acknowledged);
      });
    },
    async instructionHistory(principal: Principal, scheduleId: string, raw: unknown) {
      const input = z
        .object({
          before: z.uuid().optional(),
          limit: z.coerce.number().int().min(1).max(100).default(50),
        })
        .strict()
        .parse(raw);
      return db.transaction(async (tx) => {
        await authority(tx, principal, scheduleId);
        const [cursor] = input.before
          ? await tx
              .select()
              .from(financeHostInstructionReceipts)
              .where(
                and(
                  eq(financeHostInstructionReceipts.userId, principal.userId),
                  eq(financeHostInstructionReceipts.scheduleId, scheduleId),
                  eq(financeHostInstructionReceipts.id, input.before),
                ),
              )
          : [];
        if (input.before && !cursor)
          throw new AppError("invalid_request", "The instruction history cursor was not found.");
        const rows = await tx
          .select()
          .from(financeHostInstructionReceipts)
          .where(
            and(
              eq(financeHostInstructionReceipts.userId, principal.userId),
              eq(financeHostInstructionReceipts.scheduleId, scheduleId),
              cursor
                ? sql`(${financeHostInstructionReceipts.servedAt}, ${financeHostInstructionReceipts.id}) < (${cursor.servedAt}, ${cursor.id}::uuid)`
                : undefined,
            ),
          )
          .orderBy(
            desc(financeHostInstructionReceipts.servedAt),
            desc(financeHostInstructionReceipts.id),
          )
          .limit(input.limit + 1);
        return {
          receipts: rows.slice(0, input.limit).map(value),
          nextCursor: rows.length > input.limit ? (rows[input.limit - 1]?.id ?? null) : null,
        };
      });
    },
  };
}
