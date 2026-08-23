import { createHash } from "node:crypto";
import { type Database, financeAgentSettings, financeMutationRecords } from "@personal-os/database";
import { and, eq } from "drizzle-orm";
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
  db: Database;
  principal: Principal;
  requestId: string;
}): Promise<FinanceMutationContext> {
  const setting = await input.db.query.financeAgentSettings.findFirst({
    where: eq(financeAgentSettings.userId, input.principal.userId),
  });
  const canMutate = input.principal.scopes.has("finances:write");
  const bypassEnabled = setting?.reviewBypassEnabled ?? false;
  return {
    actorId: input.principal.actorId,
    actorType: input.principal.actorType,
    bypassEnabled,
    canMutate,
    canSelfApprove: input.principal.actorType === "agent" && canMutate && bypassEnabled,
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
      "Agent self-approval requires Finance bypass mode and the finances:write scope.",
    );
  }
}

type IdempotentOperation = {
  idempotencyKey: string;
  operation: string;
  payload: unknown;
};

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
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
  mutate: () => Promise<T>,
): Promise<T> {
  requireFinanceMutation(context);
  const hash = requestHash(operation);
  const existing = await db.query.financeMutationRecords.findFirst({
    where: and(
      eq(financeMutationRecords.userId, context.userId),
      eq(financeMutationRecords.idempotencyKey, operation.idempotencyKey),
    ),
  });
  if (existing) {
    assertMatchingMutation(existing, operation, hash);
    if (existing.status === "completed" && existing.response) return existing.response as T;
    throw new AppError(
      "conflict",
      existing.status === "started"
        ? "That Finance mutation is already in progress."
        : "That Finance mutation previously failed; use a new idempotency key to retry.",
    );
  }

  let record: typeof financeMutationRecords.$inferSelect;
  try {
    const [inserted] = await db
      .insert(financeMutationRecords)
      .values({
        actorId: context.actorId,
        actorType: context.actorType,
        idempotencyKey: operation.idempotencyKey,
        operation: operation.operation,
        requestHash: hash,
        status: "started",
        userId: context.userId,
      })
      .returning();
    if (!inserted) throw new AppError("internal_error", "Finance mutation state was not created.");
    record = inserted;
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    return executeFinanceIdempotently(db, context, operation, mutate);
  }

  try {
    const response = await mutate();
    await db
      .update(financeMutationRecords)
      .set({ completedAt: new Date(), response, status: "completed", updatedAt: new Date() })
      .where(eq(financeMutationRecords.id, record.id));
    return response;
  } catch (error) {
    await db
      .update(financeMutationRecords)
      .set({
        completedAt: new Date(),
        error: { message: error instanceof Error ? error.message : "Unknown Finance error" },
        status: "failed",
        updatedAt: new Date(),
      })
      .where(eq(financeMutationRecords.id, record.id));
    throw error;
  }
}
