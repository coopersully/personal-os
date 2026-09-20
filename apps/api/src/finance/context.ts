import { createHash } from "node:crypto";
import {
  type Database,
  executionPolicySettings,
  financeMutationRecords,
  users,
} from "@personal-os/database";
import { and, eq, sql } from "drizzle-orm";
import { AppError, isUniqueViolation } from "../errors.js";
import type { Principal } from "../types.js";

export type FinanceMutationContext = {
  actorId: string;
  actorType: Principal["actorType"];
  bypassEnabled: boolean;
  canMutate: boolean;
  canSelfApprove: boolean;
  requestId: string;
  userId: string;
};

export async function loadFinanceAuthorization(input: {
  db: Database | FinanceTransaction;
  principal: Principal;
  requestId: string;
}): Promise<FinanceMutationContext> {
  const setting = await input.db.query.executionPolicySettings.findFirst({
    where: eq(executionPolicySettings.userId, input.principal.userId),
  });
  const canMutate = input.principal.scopes.has("finances:write");
  const bypassEnabled = setting?.reviewBypassEnabled ?? false;
  return {
    actorId: input.principal.actorId,
    actorType: input.principal.actorType,
    bypassEnabled,
    canMutate,
    // Review bypass controls timing, not authority to activate a budget.
    // Fail closed until the explicit Finance budget policy supplies that authority.
    canSelfApprove: false,
    requestId: input.requestId,
    userId: input.principal.userId,
  };
}

export function requireFinanceMutation(
  context: FinanceMutationContext,
  options: { approvalSource?: "agent_self_approval" | "user_instruction" } = {},
): void {
  if (!context.canMutate) {
    throw new AppError("forbidden", "This token requires the finances:write scope.");
  }
  if (options.approvalSource === "agent_self_approval" && !context.canSelfApprove) {
    throw new AppError(
      "forbidden",
      "Agent self-approval requires an explicit Finance budget activation policy.",
    );
  }
}

type IdempotentOperation = {
  idempotencyKey: string;
  lockIdentities?: string[];
  operation: string;
  payload: unknown;
  /** Acquire owner deletion/key-change admission before every receipt or child lock. */
  requireUserAdmission?: boolean;
};
export type FinanceTransaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

async function admitFinanceUser(tx: FinanceTransaction, userId: string): Promise<boolean> {
  const [owner] = await tx
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, userId))
    .for("key share")
    .limit(1);
  return owner !== undefined;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function requestHash(operation: IdempotentOperation): string {
  return `sha256:${createHash("sha256")
    .update(stableJson({ operation: operation.operation, payload: operation.payload }))
    .digest("hex")}`;
}

function assertMatchingMutation(
  record: typeof financeMutationRecords.$inferSelect,
  operation: IdempotentOperation,
  hash: string,
): void {
  if (record.operation !== operation.operation || record.requestHash !== hash) {
    throw new AppError(
      "invalid_request",
      "That idempotency key was already used for different Finance work.",
    );
  }
}

export async function executeFinanceIdempotently<T extends Record<string, unknown>>(
  db: Database,
  context: FinanceMutationContext,
  operation: IdempotentOperation,
  mutate: (tx: FinanceTransaction) => Promise<T>,
  executor?: FinanceTransaction,
): Promise<T> {
  requireFinanceMutation(context);
  const hash = requestHash(operation);
  const lockIdentity = `finance-mutation:${context.userId}:${operation.idempotencyKey}`;
  const leaseDurationMs = 5 * 60 * 1_000;
  const whereKey = and(
    eq(financeMutationRecords.userId, context.userId),
    eq(financeMutationRecords.idempotencyKey, operation.idempotencyKey),
  );

  const execute = async (tx: FinanceTransaction, markClaimed: () => void) => {
    if (operation.requireUserAdmission && !(await admitFinanceUser(tx, context.userId))) {
      throw new AppError("not_found", "Account not found.");
    }
    // Agent actions acquire semantic locks while revalidating. Direct writers
    // must take those same locks before their idempotency lock so the two paths
    // cannot form a reversed-order advisory-lock cycle.
    for (const identity of [...new Set(operation.lockIdentities ?? [])].sort())
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${identity}, 0))`);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${lockIdentity}, 0))`);
    const existing = await tx.query.financeMutationRecords.findFirst({ where: whereKey });
    const claimedAt = new Date();
    const leaseExpiresAt = new Date(claimedAt.getTime() + leaseDurationMs);
    let record = existing;
    if (record) {
      assertMatchingMutation(record, operation, hash);
      if (record.status === "completed" && record.response) return record.response as T;
      if (record.status === "failed")
        throw new AppError(
          "conflict",
          "That Finance mutation previously failed; use a new idempotency key to retry.",
        );
      const existingLease =
        record.leaseExpiresAt ?? new Date(record.updatedAt.getTime() + leaseDurationMs);
      if (existingLease > claimedAt)
        throw new AppError("conflict", "That Finance mutation is already in progress.");
      const [reclaimed] = await tx
        .update(financeMutationRecords)
        .set({ leaseExpiresAt, updatedAt: claimedAt })
        .where(
          and(
            eq(financeMutationRecords.id, record.id),
            eq(financeMutationRecords.status, "started"),
          ),
        )
        .returning();
      /* v8 ignore start -- the advisory lock keeps the selected started row stable in this transaction. */
      if (!reclaimed)
        throw new AppError("conflict", "That Finance mutation could not be reclaimed.");
      /* v8 ignore stop */
      record = reclaimed;
    } else {
      const [inserted] = await tx
        .insert(financeMutationRecords)
        .values({
          actorId: context.actorId,
          actorType: context.actorType,
          idempotencyKey: operation.idempotencyKey,
          leaseExpiresAt,
          operation: operation.operation,
          requestHash: hash,
          status: "started",
          userId: context.userId,
        })
        .returning();
      /* v8 ignore start -- PostgreSQL INSERT ... RETURNING yields the inserted row or throws. */
      if (!inserted)
        throw new AppError("internal_error", "Finance mutation state was not created.");
      /* v8 ignore stop */
      record = inserted;
    }
    markClaimed();
    const response = await mutate(tx);
    await tx
      .update(financeMutationRecords)
      .set({
        completedAt: new Date(),
        leaseExpiresAt: null,
        response,
        status: "completed",
        updatedAt: new Date(),
      })
      .where(eq(financeMutationRecords.id, record.id));
    return response;
  };

  // Agent actions already own a terminal transaction. Reuse it so the
  // idempotency claim, semantic write, audit, and action terminalization commit
  // atomically without opening a second connection behind held locks.
  if (executor) return execute(executor, () => {});

  for (let attempt = 0; attempt < 2; attempt += 1) {
    let claimed = false;
    try {
      return await db.transaction((tx) => execute(tx, () => (claimed = true)));
    } catch (error) {
      if (isUniqueViolation(error) && !claimed && attempt === 0) continue;
      if (claimed) {
        await db.transaction(async (tx) => {
          // The owner may have been deleted after the operation rolled back. In that case a
          // user-owned failure receipt cannot survive, so preserve the original operation error.
          if (operation.requireUserAdmission && !(await admitFinanceUser(tx, context.userId)))
            return;
          await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${lockIdentity}, 0))`);
          const existing = await tx.query.financeMutationRecords.findFirst({ where: whereKey });
          if (existing?.status === "completed" || existing?.status === "failed") return;
          const failure = {
            completedAt: new Date(),
            error: { message: error instanceof Error ? error.message : "Unknown Finance error" },
            leaseExpiresAt: null,
            status: "failed" as const,
            updatedAt: new Date(),
          };
          if (existing) {
            await tx
              .update(financeMutationRecords)
              .set(failure)
              .where(eq(financeMutationRecords.id, existing.id));
          } else {
            await tx.insert(financeMutationRecords).values({
              actorId: context.actorId,
              actorType: context.actorType,
              idempotencyKey: operation.idempotencyKey,
              operation: operation.operation,
              requestHash: hash,
              ...failure,
              userId: context.userId,
            });
          }
        });
      }
      throw error;
    }
  }
  /* v8 ignore next -- each bounded attempt returns, throws, or advances only to the final throwing attempt. */
  throw new AppError("conflict", "That Finance mutation could not obtain its idempotency record.");
}
