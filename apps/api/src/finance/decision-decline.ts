import { auditEvents, type Database, financeDecisionDeclines } from "@personal-os/database";
import { type FinanceDecisionDecline, financeDecisionDeclineSchema } from "@personal-os/domain";
import { and, eq, inArray } from "drizzle-orm";
import { auditValues } from "../audit.js";
import { AppError } from "../errors.js";
import type { Principal } from "../types.js";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Context = { principal: Principal; requestId: string };
export type FinanceDeclineKind = FinanceDecisionDecline["kind"];

const labels: Record<FinanceDeclineKind, string> = {
  review_batch: "batch",
  budget_start_preview: "starting-month preview",
  review_batch_undo: "correction",
};

/** A decline is the person's own answer. No agent grant, of any scope, can give it. */
export function requireFinanceDeclineOwner({ principal }: Context) {
  if (
    principal.actorType !== "user" ||
    principal.actorId !== principal.userId ||
    !principal.scopes.has("finances:write")
  )
    throw new AppError("forbidden", "Only the owner can decline this with their own account.");
}

const declined = (tx: Transaction, userId: string, kind: FinanceDeclineKind, id: string) =>
  tx
    .select()
    .from(financeDecisionDeclines)
    .where(
      and(
        eq(financeDecisionDeclines.userId, userId),
        eq(financeDecisionDeclines.targetKind, kind),
        eq(financeDecisionDeclines.targetId, id),
      ),
    )
    .limit(1);

/** Decline times for reads, keyed by target id; an absent id was never declined. */
export async function readFinanceDeclinedAt(
  tx: Pick<Database, "select">,
  userId: string,
  kind: FinanceDeclineKind,
  ids: string[],
) {
  if (!ids.length) return new Map<string, string>();
  const rows = await tx
    .select({
      id: financeDecisionDeclines.targetId,
      declinedAt: financeDecisionDeclines.declinedAt,
    })
    .from(financeDecisionDeclines)
    .where(
      and(
        eq(financeDecisionDeclines.userId, userId),
        eq(financeDecisionDeclines.targetKind, kind),
        inArray(financeDecisionDeclines.targetId, ids),
      ),
    );
  return new Map(rows.map((row) => [row.id, row.declinedAt.toISOString()]));
}

/** Call under the target's row lock, before approving or applying any effect. */
export async function assertFinanceDecisionNotDeclined(
  tx: Transaction,
  userId: string,
  kind: FinanceDeclineKind,
  id: string,
) {
  const [row] = await declined(tx, userId, kind, id);
  if (row)
    throw new AppError(
      "conflict",
      `The owner declined this ${labels[kind]}. Prepare a new preview instead.`,
      { recovery: "new_preview" },
    );
}

/** Call under the target's row lock after confirming ownership. Repeats return the first. */
export async function recordFinanceDecisionDecline(
  tx: Transaction,
  context: Context,
  kind: FinanceDeclineKind,
  id: string,
  at: Date,
): Promise<FinanceDecisionDecline> {
  const userId = context.principal.userId;
  const [created] = await tx
    .insert(financeDecisionDeclines)
    .values({ userId, targetKind: kind, targetId: id, declinedBy: userId, declinedAt: at })
    .onConflictDoNothing({
      target: [
        financeDecisionDeclines.userId,
        financeDecisionDeclines.targetKind,
        financeDecisionDeclines.targetId,
      ],
    })
    .returning();
  const [row] = created ? [created] : await declined(tx, userId, kind, id);
  if (!row) throw new AppError("internal_error", "The decline was not saved.");
  const result = financeDecisionDeclineSchema.parse({
    kind,
    id,
    declinedAt: row.declinedAt.toISOString(),
    recovery: "new_preview",
  });
  if (created)
    await tx.insert(auditEvents).values(
      auditValues({
        ...context,
        action: `finance_${kind}.declined`,
        entityType: `finance_${kind}`,
        entityId: id,
        before: null,
        after: result,
      }),
    );
  return result;
}
