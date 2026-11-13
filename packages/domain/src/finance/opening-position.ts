import { z } from "zod";
import { financeMonthSchema } from "./budget.js";

const cents = z.number().int().safe();
export const financeOpeningPositionInputSchema = z.strictObject({
  month: financeMonthSchema,
  accounts: z
    .array(
      z.strictObject({
        accountId: z.string().min(1),
        identityKey: z.string().min(1).nullable(),
        currency: z.string().nullable(),
        sourceCurrent: z.boolean(),
        // Signed asset position: liabilities are negative. This is a posted closing statement,
        // never an available balance or an intraday value assumed to include a whole day.
        statement: z
          .strictObject({
            date: z.iso.date(),
            signedClosingBalanceCents: cents,
            includesThroughDate: z.boolean(),
          })
          .nullable(),
        coverage: z.array(z.strictObject({ from: z.iso.date(), through: z.iso.date() })),
        movements: z.array(
          z.strictObject({
            id: z.string().min(1),
            date: z.iso.date(),
            signedBalanceDeltaCents: cents.nullable(),
            pending: z.boolean(),
            evidenceComplete: z.boolean(),
          }),
        ),
      }),
    )
    .max(100),
});
export type FinanceOpeningPositionInput = z.infer<typeof financeOpeningPositionInputSchema>;
const day = (date: string) => Date.parse(`${date}T00:00:00Z`) / 86_400_000;

/** Reconstruct balances only; this does not classify spending or approve a plan. */
export function qualifyFinanceOpeningPosition(raw: FinanceOpeningPositionInput) {
  const input = financeOpeningPositionInputSchema.parse(raw);
  const from = `${input.month}-01`;
  const identityCounts = new Map<string, number>();
  const accountCounts = new Map<string, number>();
  for (const account of input.accounts) {
    accountCounts.set(account.accountId, (accountCounts.get(account.accountId) ?? 0) + 1);
    if (account.identityKey)
      identityCounts.set(account.identityKey, (identityCounts.get(account.identityKey) ?? 0) + 1);
  }
  const accounts = input.accounts.map((account) => {
    const reasons: string[] = [];
    const statement = account.statement;
    if (!account.identityKey) reasons.push("account_identity_unknown");
    if (
      (accountCounts.get(account.accountId) ?? 0) > 1 ||
      (account.identityKey && (identityCounts.get(account.identityKey) ?? 0) > 1)
    )
      reasons.push("duplicate_account");
    if (account.currency !== "USD") reasons.push("currency_unqualified");
    if (!account.sourceCurrent) reasons.push("source_not_current");
    if (!statement?.includesThroughDate) reasons.push("closing_statement_required");
    const carryForward = !!statement && day(statement.date) < day(from);
    const intervalStart = carryForward && statement ? day(statement.date) + 1 : day(from);
    const intervalEnd = carryForward
      ? day(from) - 1
      : statement
        ? day(statement.date)
        : day(from) - 1;
    let coveredThrough = intervalStart - 1;
    if (statement) {
      for (const interval of [...account.coverage].sort((a, b) => a.from.localeCompare(b.from))) {
        if (interval.from > interval.through) continue;
        if (day(interval.from) > coveredThrough + 1) break;
        coveredThrough = Math.max(coveredThrough, day(interval.through));
      }
      if (coveredThrough < intervalEnd) reasons.push("incomplete_coverage");
    }
    const ids = new Set<string>();
    let delta = 0;
    for (const movement of account.movements) {
      if (
        !statement ||
        day(movement.date) < intervalStart ||
        day(movement.date) > intervalEnd ||
        movement.pending
      )
        continue;
      if (ids.has(movement.id)) reasons.push("duplicate_movement");
      ids.add(movement.id);
      if (!movement.evidenceComplete || movement.signedBalanceDeltaCents === null) {
        reasons.push("movement_evidence_missing");
        continue;
      }
      delta += movement.signedBalanceDeltaCents;
      if (!Number.isSafeInteger(delta)) reasons.push("amount_out_of_range");
    }
    const opening = statement
      ? statement.signedClosingBalanceCents + (carryForward ? delta : -delta)
      : null;
    if (opening !== null && !Number.isSafeInteger(opening)) reasons.push("amount_out_of_range");
    return {
      accountId: account.accountId,
      openingBalanceCents: reasons.length ? null : opening,
      reasons: [...new Set(reasons)],
      statementDate: statement?.date ?? null,
    };
  });
  return {
    month: input.month,
    qualified: accounts.length > 0 && accounts.every((account) => account.reasons.length === 0),
    accounts,
    reasons: accounts.length
      ? [...new Set(accounts.flatMap((account) => account.reasons))]
      : ["accounts_required"],
  };
}

export const confirmFinanceOpeningStatementInputSchema = z.strictObject({
  accountId: z.uuid(),
  month: financeMonthSchema,
  expectedAccountRevision: z.string().regex(/^[1-9][0-9]*$/),
  expectedStatementRevision: z.number().int().min(0).max(2147483646),
  signedOpeningBalanceCents: cents.min(-10000000000).max(10000000000),
  idempotencyKey: z.string().trim().min(1).max(200),
});

export const financeOpeningStatementSchema = z.strictObject({
  id: z.uuid(),
  accountId: z.uuid(),
  month: financeMonthSchema,
  revision: z.number().int().positive(),
  signedOpeningBalanceCents: cents,
  currencyCode: z.literal("USD"),
  recordedAt: z.iso.datetime(),
  source: z.literal("user_statement"),
});
export const financeOpeningPositionSchema = z.strictObject({
  month: financeMonthSchema,
  qualified: z.boolean(),
  reasons: z.array(z.string()),
  accounts: z.array(
    z.strictObject({
      accountId: z.uuid(),
      name: z.string(),
      accountRevision: z.string().regex(/^[1-9][0-9]*$/),
      currencyCode: z.string().nullable(),
      kind: z.enum(["cash", "investment", "debt", "other"]),
      openingBalanceCents: cents.nullable(),
      reasons: z.array(z.string()),
      statementDate: z.iso.date().nullable(),
    }),
  ),
  statements: z.array(financeOpeningStatementSchema),
  asOf: z.iso.datetime(),
  timezone: z.string(),
});
export type FinanceOpeningPosition = z.infer<typeof financeOpeningPositionSchema>;
export type FinanceOpeningStatement = z.infer<typeof financeOpeningStatementSchema>;
export type ConfirmFinanceOpeningStatementInput = z.infer<
  typeof confirmFinanceOpeningStatementInputSchema
>;
