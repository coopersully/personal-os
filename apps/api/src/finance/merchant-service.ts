import {
  auditEvents,
  type Database,
  financeClassificationDecisions,
  financeMerchantAliases,
  financeMerchants,
  financeTransactions,
} from "@personal-os/database";
import type {
  FinanceMerchant,
  MergeFinanceMerchantsInput,
  UpdateFinanceMerchantInput,
} from "@personal-os/domain";
import { and, desc, eq, inArray } from "drizzle-orm";
import { type AuditMutation, auditValues } from "../audit.js";
import { requireDatabaseRecord } from "../database.js";
import { AppError } from "../errors.js";
import { normalizedMerchant, titleCaseMerchant } from "./merchant-identity.js";

type FinanceReadExecutor = Pick<Database, "select">;
type FinanceWriteExecutor = Pick<Database, "insert" | "select" | "update">;
type FinanceActionWriteExecutor = FinanceWriteExecutor & Pick<Database, "delete" | "execute">;
type MutationContext = Pick<AuditMutation, "principal" | "requestId">;

function merchant(
  row: typeof financeMerchants.$inferSelect,
  aliases: string[] = [],
): FinanceMerchant {
  return {
    aliases,
    behavior: row.behavior,
    displayName: row.displayName,
    id: row.id,
    isUserConfirmed: row.isUserConfirmed,
  };
}
function merchantAuditSnapshot(value: FinanceMerchant) {
  return {
    id: value.id,
    isUserConfirmed: value.isUserConfirmed,
  };
}

export function createFinanceMerchantService({ db, now }: { db: Database; now: () => Date }) {
  async function merchantFor(
    userId: string,
    rawMerchant: string,
    source: "agent" | "provider" | "user",
    executor: FinanceWriteExecutor = db,
  ) {
    const normalizedName = normalizedMerchant(rawMerchant);
    const [alias] = await executor
      .select({ merchant: financeMerchants })
      .from(financeMerchantAliases)
      .innerJoin(financeMerchants, eq(financeMerchantAliases.merchantId, financeMerchants.id))
      .where(
        and(
          eq(financeMerchantAliases.userId, userId),
          eq(financeMerchantAliases.normalizedName, normalizedName),
        ),
      )
      .limit(1);
    if (alias) return alias.merchant;
    const [merchant] = await executor
      .insert(financeMerchants)
      .values({
        displayName: titleCaseMerchant(normalizedName || rawMerchant),
        normalizedName,
        userId,
      })
      .onConflictDoUpdate({
        set: { updatedAt: now() },
        target: [financeMerchants.userId, financeMerchants.normalizedName],
      })
      .returning();
    const resolved = requireDatabaseRecord(merchant, "The merchant could not be saved.");
    await executor
      .insert(financeMerchantAliases)
      .values({
        confidence: 10_000,
        merchantId: resolved.id,
        normalizedName,
        rawName: rawMerchant,
        source,
        userId,
      })
      .onConflictDoNothing({
        target: [financeMerchantAliases.userId, financeMerchantAliases.normalizedName],
      });
    return resolved;
  }

  async function ownedMerchant(userId: string, id: string, executor: FinanceReadExecutor = db) {
    const [row] = await executor
      .select()
      .from(financeMerchants)
      .where(and(eq(financeMerchants.id, id), eq(financeMerchants.userId, userId)))
      .limit(1);
    if (!row) throw new AppError("not_found", "The finance merchant was not found.");
    return row;
  }
  return {
    merchantFor,
    async listMerchants(userId: string, limit = 50) {
      const merchants = await db
        .select()
        .from(financeMerchants)
        .where(eq(financeMerchants.userId, userId))
        .orderBy(desc(financeMerchants.updatedAt), financeMerchants.displayName)
        .limit(limit);
      if (merchants.length === 0) return [];
      const aliases = await db
        .select()
        .from(financeMerchantAliases)
        .where(
          and(
            eq(financeMerchantAliases.userId, userId),
            inArray(
              financeMerchantAliases.merchantId,
              merchants.map((item) => item.id),
            ),
          ),
        )
        .orderBy(financeMerchantAliases.rawName);
      return merchants.map((item) =>
        merchant(
          item,
          aliases.filter((alias) => alias.merchantId === item.id).map((alias) => alias.rawName),
        ),
      );
    },
    async updateMerchant(
      id: string,
      input: UpdateFinanceMerchantInput,
      context: MutationContext,
      executor: FinanceWriteExecutor = db,
    ) {
      const before = await ownedMerchant(context.principal.userId, id, executor);
      const updated = requireDatabaseRecord(
        (
          await executor
            .update(financeMerchants)
            .set({
              displayName: input.displayName,
              isUserConfirmed:
                context.principal.actorType === "user" ? true : before.isUserConfirmed,
              updatedAt: now(),
            })
            .where(eq(financeMerchants.id, before.id))
            .returning()
        )[0],
        "The finance merchant could not be updated.",
      );
      await executor.insert(auditEvents).values(
        auditValues({
          action: "finance.merchant_renamed",
          after: {
            ...merchantAuditSnapshot(merchant(updated)),
            changedFields: ["displayName"],
          },
          before: merchantAuditSnapshot(merchant(before)),
          entityId: updated.id,
          entityType: "finance_merchant",
          ...context,
        }),
      );
      return merchant(updated);
    },
    async mergeMerchants(
      input: MergeFinanceMerchantsInput,
      context: MutationContext,
      executor?: FinanceActionWriteExecutor,
    ) {
      const merge = async (tx: FinanceActionWriteExecutor) => {
        const locked = await tx
          .select()
          .from(financeMerchants)
          .where(
            and(
              eq(financeMerchants.userId, context.principal.userId),
              inArray(financeMerchants.id, [input.sourceMerchantId, input.targetMerchantId]),
            ),
          )
          .orderBy(financeMerchants.id)
          .for("update");
        const source = locked.find((item) => item.id === input.sourceMerchantId);
        const target = locked.find((item) => item.id === input.targetMerchantId);
        if (!source || !target) {
          throw new AppError("not_found", "One of the finance merchants was not found.");
        }
        await tx
          .update(financeMerchantAliases)
          .set({ merchantId: target.id, updatedAt: now() })
          .where(
            and(
              eq(financeMerchantAliases.userId, context.principal.userId),
              eq(financeMerchantAliases.merchantId, source.id),
            ),
          );
        await tx
          .update(financeTransactions)
          .set({ merchantId: target.id, updatedAt: now() })
          .where(
            and(
              eq(financeTransactions.userId, context.principal.userId),
              eq(financeTransactions.merchantId, source.id),
            ),
          );
        await tx
          .update(financeClassificationDecisions)
          .set({ merchantId: target.id })
          .where(
            and(
              eq(financeClassificationDecisions.userId, context.principal.userId),
              eq(financeClassificationDecisions.merchantId, source.id),
            ),
          );
        await tx.delete(financeMerchants).where(eq(financeMerchants.id, source.id));
        await tx.insert(auditEvents).values(
          auditValues({
            action: "finance.merchants_merged",
            after: {
              rationaleProvided: true,
              sourceMerchantId: source.id,
              targetMerchantId: target.id,
            },
            before: merchantAuditSnapshot(merchant(source)),
            entityId: target.id,
            entityType: "finance_merchant",
            ...context,
          }),
        );
        return merchant(target);
      };
      return executor ? merge(executor) : db.transaction(merge);
    },
  };
}
