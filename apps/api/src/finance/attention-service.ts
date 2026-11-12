import { createHash } from "node:crypto";
import {
  auditEvents,
  type Database,
  financeBudgetStartPolicies,
  financeBudgetStartPreviews,
  users,
} from "@personal-os/database";
import {
  applyFinanceBudgetStartInputSchema,
  financeBudgetStartPolicySchema,
  financeBudgetStartPreviewSchema,
  idSchema,
  previewFinanceBudgetStartInputSchema,
} from "@personal-os/domain";
import { and, desc, eq } from "drizzle-orm";
import { auditValues } from "../audit.js";
import { AppError } from "../errors.js";
import type { Principal } from "../types.js";
import { readFinanceAttentionSnapshot } from "./attention-read.js";
import type { FinanceTransaction } from "./context.js";

type Context = { principal: Principal; requestId: string };
function policy(row: typeof financeBudgetStartPolicies.$inferSelect) {
  return financeBudgetStartPolicySchema.parse({
    firstMonth: row.firstMonth,
    timezone: row.timezone,
    revision: row.revision,
    approvedAt: row.approvedAt.toISOString(),
    approvalSource: "user_instruction",
  });
}
function preview(row: typeof financeBudgetStartPreviews.$inferSelect) {
  return financeBudgetStartPreviewSchema.parse({
    id: row.id,
    fingerprint: row.fingerprint,
    proposedMonth: row.firstMonth,
    timezone: row.timezone,
    expectedPolicyRevision: row.expectedPolicyRevision,
    attention: row.attention,
    projectedAttention: row.projectedAttention,
  });
}

/** Scope policy only: approval does not qualify a balance or resolve a transaction. */
export function createFinanceAttentionService({ db, now }: { db: Database; now: () => Date }) {
  const latest = (tx: Database | FinanceTransaction, userId: string) =>
    tx.query.financeBudgetStartPolicies.findFirst({
      where: eq(financeBudgetStartPolicies.userId, userId),
      orderBy: desc(financeBudgetStartPolicies.revision),
    });
  async function ownerLock(tx: FinanceTransaction, userId: string) {
    const [owner] = await tx
      .select({ id: users.id, timezone: users.planningTimezone })
      .from(users)
      .where(eq(users.id, userId))
      .for("update")
      .limit(1);
    if (!owner) throw new AppError("not_found", "Account not found.");
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: owner.timezone }).format(now());
    } catch {
      throw new AppError(
        "invalid_request",
        "Repair your default time zone before changing the budget starting month.",
      );
    }
    return owner;
  }
  return {
    getAttentionSnapshot(userId: string) {
      return readFinanceAttentionSnapshot(db, userId, now());
    },
    async getBudgetStart(userId: string) {
      const row = await latest(db, userId);
      return row ? policy(row) : null;
    },
    async getBudgetStartPreview(context: Context, rawId: string) {
      if (!context.principal.scopes.has("finances:read"))
        throw new AppError("forbidden", "Finance read access is required.");
      const row = await db.query.financeBudgetStartPreviews.findFirst({
        where: and(
          eq(financeBudgetStartPreviews.id, idSchema.parse(rawId)),
          eq(financeBudgetStartPreviews.userId, context.principal.userId),
        ),
      });
      if (
        !row ||
        (context.principal.actorType === "agent" &&
          (row.actorType !== "agent" || row.actorId !== context.principal.actorId))
      )
        throw new AppError(
          "not_found",
          "The starting-policy preview was not found for this authorization.",
        );
      return preview(row);
    },
    async previewBudgetStart(context: Context, rawInput: unknown) {
      const input = previewFinanceBudgetStartInputSchema.parse(rawInput);
      if (!context.principal.scopes.has("finances:write"))
        throw new AppError("forbidden", "Finance write access is required.");
      return db.transaction(
        async (tx) => {
          const owner = await ownerLock(tx, context.principal.userId);
          const existing = await tx.query.financeBudgetStartPreviews.findFirst({
            where: and(
              eq(financeBudgetStartPreviews.userId, owner.id),
              eq(financeBudgetStartPreviews.idempotencyKey, input.idempotencyKey),
            ),
          });
          if (existing) {
            if (
              existing.actorId !== context.principal.actorId ||
              existing.actorType !== context.principal.actorType ||
              existing.firstMonth !== input.firstMonth ||
              existing.expectedPolicyRevision !== input.expectedPolicyRevision ||
              existing.timezone !== owner.timezone
            )
              throw new AppError("conflict", "This preview key belongs to a different request.");
            return preview(existing);
          }
          const current = await latest(tx, owner.id);
          if ((current?.revision ?? 0) !== input.expectedPolicyRevision)
            throw new AppError(
              "conflict",
              "The budget starting policy changed. Refresh and preview again.",
            );
          const at = now();
          const attention = await readFinanceAttentionSnapshot(db, owner.id, at, tx);
          const projectedAttention = await readFinanceAttentionSnapshot(db, owner.id, at, tx, {
            firstMonth: input.firstMonth,
          });
          const fingerprint = `sha256:${createHash("sha256")
            .update(
              JSON.stringify({
                userId: owner.id,
                actorId: context.principal.actorId,
                actorType: context.principal.actorType,
                firstMonth: input.firstMonth,
                expectedPolicyRevision: input.expectedPolicyRevision,
                timezone: owner.timezone,
                snapshot: attention.snapshot,
              }),
            )
            .digest("hex")}`;
          const [row] = await tx
            .insert(financeBudgetStartPreviews)
            .values({
              userId: owner.id,
              actorId: context.principal.actorId,
              actorType: context.principal.actorType,
              idempotencyKey: input.idempotencyKey,
              firstMonth: input.firstMonth,
              expectedPolicyRevision: input.expectedPolicyRevision,
              timezone: owner.timezone,
              fingerprint,
              attention,
              projectedAttention,
              createdAt: now(),
            })
            .returning();
          if (!row)
            throw new AppError("internal_error", "The starting policy preview was not created.");
          return preview(row);
        },
        { isolationLevel: "repeatable read" },
      );
    },
    async applyBudgetStart(context: Context, rawInput: unknown) {
      const input = applyFinanceBudgetStartInputSchema.parse(rawInput);
      const { principal } = context;
      // Only an authenticated owner approves this visibility policy. A caller-supplied
      // source string or an agent write grant cannot serve as human approval.
      if (
        principal.actorType !== "user" ||
        principal.actorId !== principal.userId ||
        !principal.scopes.has("finances:write")
      )
        throw new AppError(
          "forbidden",
          "Approve this exact starting policy with your own account.",
        );
      return db.transaction(async (tx) => {
        const owner = await ownerLock(tx, principal.userId);
        const prepared = await tx.query.financeBudgetStartPreviews.findFirst({
          where: and(
            eq(financeBudgetStartPreviews.id, input.previewId),
            eq(financeBudgetStartPreviews.userId, owner.id),
          ),
        });
        if (!prepared) throw new AppError("not_found", "Starting policy preview not found.");
        if (!prepared.projectedAttention)
          throw new AppError(
            "conflict",
            "Prepare a fresh starting-policy preview with its expected impact.",
          );
        if (prepared.fingerprint !== input.fingerprint)
          throw new AppError("conflict", "This approval does not match the preview.");
        const applied = await tx.query.financeBudgetStartPolicies.findFirst({
          where: and(
            eq(financeBudgetStartPolicies.userId, owner.id),
            eq(financeBudgetStartPolicies.previewId, prepared.id),
          ),
        });
        if (applied) return policy(applied);
        const attention = await readFinanceAttentionSnapshot(db, owner.id, now(), tx, {
          excludeBudgetStartPreviewId: prepared.id,
        });
        if (attention.snapshot !== prepared.attention.snapshot)
          throw new AppError(
            "conflict",
            "Finance attention changed. Review a fresh starting-policy preview.",
          );
        const current = await latest(tx, owner.id);
        if (
          (current?.revision ?? 0) !== prepared.expectedPolicyRevision ||
          owner.timezone !== prepared.timezone
        )
          throw new AppError("conflict", "Your policy or time zone changed. Review a new preview.");
        const [row] = await tx
          .insert(financeBudgetStartPolicies)
          .values({
            userId: owner.id,
            firstMonth: prepared.firstMonth,
            timezone: prepared.timezone,
            revision: prepared.expectedPolicyRevision + 1,
            approvedAt: now(),
            approvedBy: principal.actorId,
            previewId: prepared.id,
          })
          .returning();
        if (!row) throw new AppError("internal_error", "The starting policy was not saved.");
        await tx.insert(auditEvents).values(
          auditValues({
            action: "finance.budget_start.approved",
            entityType: "finance_budget_start_policy",
            entityId: row.id,
            principal,
            requestId: context.requestId,
            before: current ? policy(current) : null,
            after: policy(row),
          }),
        );
        return policy(row);
      });
    },
  };
}
