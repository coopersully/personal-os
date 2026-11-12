import { createHash } from "node:crypto";
import {
  auditEvents,
  type Database,
  financeAccounts,
  financeOpeningStatements,
  financeProviderItems,
  financeTransactionCoverage,
  financeTransactions,
  users,
} from "@personal-os/database";
import {
  confirmFinanceOpeningStatementInputSchema,
  financeMonthSchema,
  qualifyFinanceOpeningPosition,
} from "@personal-os/domain";
import { and, desc, eq, gte, lt, lte } from "drizzle-orm";
import { auditValues } from "../audit.js";
import { AppError } from "../errors.js";
import type { Principal } from "../types.js";
import type { FinanceTransaction } from "./context.js";

type Context = { principal: Principal; requestId: string };
const present = (row: typeof financeOpeningStatements.$inferSelect) => ({
  id: row.id,
  accountId: row.accountId,
  month: row.month,
  revision: row.revision,
  signedOpeningBalanceCents: row.signedOpeningBalanceCents,
  currencyCode: row.currencyCode,
  recordedAt: row.recordedAt.toISOString(),
  source: "user_statement" as const,
});

export function createFinanceOpeningPositionService({
  db,
  now,
}: {
  db: Database;
  now: () => Date;
}) {
  return {
    async confirmOpeningStatement(context: Context, raw: unknown) {
      const input = confirmFinanceOpeningStatementInputSchema.parse(raw);
      const { principal } = context;
      if (
        principal.actorType !== "user" ||
        principal.actorId !== principal.userId ||
        !principal.scopes.has("finances:write")
      )
        throw new AppError("forbidden", "Confirm the opening statement with your own account.");
      return db.transaction(async (tx) => {
        const [owner] = await tx
          .select()
          .from(users)
          .where(eq(users.id, principal.userId))
          .for("update")
          .limit(1);
        if (!owner) throw new AppError("not_found", "Account not found.");
        const fingerprint = createHash("sha256").update(JSON.stringify(input)).digest("hex");
        const existing = await tx.query.financeOpeningStatements.findFirst({
          where: and(
            eq(financeOpeningStatements.userId, owner.id),
            eq(financeOpeningStatements.idempotencyKey, input.idempotencyKey),
          ),
        });
        if (existing) {
          if (existing.fingerprint !== fingerprint)
            throw new AppError("conflict", "This statement key belongs to different values.");
          return present(existing);
        }
        const account = await tx.query.financeAccounts.findFirst({
          where: and(eq(financeAccounts.userId, owner.id), eq(financeAccounts.id, input.accountId)),
        });
        if (!account) throw new AppError("not_found", "Account not found.");
        if (
          account.contextualRevision.toString() !== input.expectedAccountRevision ||
          account.currencyCode !== "USD"
        )
          throw new AppError(
            "conflict",
            "Refresh this account and verify its USD currency before confirming.",
          );
        const current = await tx.query.financeOpeningStatements.findFirst({
          where: and(
            eq(financeOpeningStatements.userId, owner.id),
            eq(financeOpeningStatements.accountId, account.id),
            eq(financeOpeningStatements.month, input.month),
          ),
          orderBy: desc(financeOpeningStatements.revision),
        });
        if ((current?.revision ?? 0) !== input.expectedStatementRevision)
          throw new AppError(
            "conflict",
            "The opening statement changed. Review its current values.",
          );
        const [row] = await tx
          .insert(financeOpeningStatements)
          .values({
            userId: owner.id,
            accountId: account.id,
            month: input.month,
            revision: input.expectedStatementRevision + 1,
            accountRevision: account.contextualRevision.toString(),
            timezone: owner.planningTimezone,
            signedOpeningBalanceCents: input.signedOpeningBalanceCents,
            currencyCode: "USD",
            actorId: owner.id,
            idempotencyKey: input.idempotencyKey,
            fingerprint,
            recordedAt: now(),
          })
          .returning();
        if (!row) throw new AppError("internal_error", "The statement was not saved.");
        await tx.insert(auditEvents).values(
          auditValues({
            action: "finance.opening_statement.confirmed",
            entityType: "finance_opening_statement",
            entityId: row.id,
            principal,
            requestId: context.requestId,
            before: current ? present(current) : null,
            after: present(row),
          }),
        );
        return present(row);
      });
    },
    async readOpeningPosition(userId: string, rawMonth: string, executor?: FinanceTransaction) {
      const month = financeMonthSchema.parse(rawMonth);
      const read = async (tx: FinanceTransaction) => {
        const owner = await tx.query.users.findFirst({ where: eq(users.id, userId) });
        if (!owner) throw new AppError("not_found", "Account not found.");
        const accounts = await tx
          .select()
          .from(financeAccounts)
          .where(
            and(eq(financeAccounts.userId, userId), eq(financeAccounts.includeInPlanning, true)),
          )
          .limit(101);
        if (accounts.length > 100)
          throw new AppError(
            "invalid_request",
            "The opening position supports at most 100 planning accounts.",
          );
        const statements = await tx
          .select()
          .from(financeOpeningStatements)
          .where(
            and(
              eq(financeOpeningStatements.userId, userId),
              lte(financeOpeningStatements.month, month),
            ),
          )
          .orderBy(desc(financeOpeningStatements.month), desc(financeOpeningStatements.revision));
        const items = await tx
          .select()
          .from(financeProviderItems)
          .where(eq(financeProviderItems.userId, userId));
        const oldestMonth = statements.at(-1)?.month ?? month;
        const movements = await tx
          .select()
          .from(financeTransactions)
          .where(
            and(
              eq(financeTransactions.userId, userId),
              gte(financeTransactions.transactionDate, `${oldestMonth}-01`),
              lt(financeTransactions.transactionDate, `${month}-01`),
            ),
          )
          .limit(100001);
        if (movements.length > 100000)
          throw new AppError(
            "invalid_request",
            "Verify a more recent opening statement before reconstructing this position.",
          );
        const coverage = await tx
          .select()
          .from(financeTransactionCoverage)
          .where(
            and(
              eq(financeTransactionCoverage.userId, userId),
              eq(financeTransactionCoverage.timezone, owner.planningTimezone),
              eq(financeTransactionCoverage.currencyCode, "USD"),
              lte(financeTransactionCoverage.recordedAt, now()),
            ),
          );
        const result = qualifyFinanceOpeningPosition({
          month,
          accounts: accounts.map((account) => {
            const latest = statements.find((row) => row.accountId === account.id);
            // Never resurrect an older statement after a correction changes its validity.
            const statement =
              latest &&
              latest.recordedAt <= now() &&
              latest.timezone === owner.planningTimezone &&
              latest.accountRevision === account.contextualRevision.toString() &&
              (latest.month === month || account.kind === "cash")
                ? latest
                : null;
            const dateBefore = statement
              ? new Date(Date.parse(`${statement.month}-01T00:00:00Z`) - 86400000)
                  .toISOString()
                  .slice(0, 10)
              : null;
            const item = items.find((row) => row.id === account.providerItemRecordId);
            const sourceCurrent =
              account.provider === "manual" ||
              (account.status === "connected" &&
                item?.syncState === "current" &&
                !!item.lastSyncedAt &&
                item.lastSyncedAt <= now() &&
                item.lastSyncedAt.getTime() >= now().getTime() - 86400000);
            return {
              accountId: account.id,
              identityKey:
                account.provider === "manual"
                  ? `manual:${account.id}`
                  : account.providerPersistentAccountId
                    ? `plaid:${account.providerPersistentAccountId}`
                    : null,
              currency: account.currencyCode,
              sourceCurrent:
                sourceCurrent &&
                account.ownershipType !== "unknown" &&
                account.ownershipShareBps !== null,
              statement:
                statement && dateBefore
                  ? {
                      date: dateBefore,
                      signedClosingBalanceCents: statement.signedOpeningBalanceCents,
                      includesThroughDate: true,
                    }
                  : null,
              coverage: coverage
                .filter((row) => row.accountId === account.id && row.evidenceRef.trim())
                .map((row) => ({ from: row.fromDate, through: row.throughDate })),
              movements: movements
                .filter((row) => row.accountId === account.id)
                .map((row) => {
                  const direction =
                    row.providerDirection ??
                    (account.provider === "manual" && row.direction !== "transfer"
                      ? row.direction
                      : null);
                  return {
                    id: row.id,
                    date: row.transactionDate,
                    pending: row.pending,
                    evidenceComplete: row.currencyCode === "USD" && row.amount >= 0 && !!direction,
                    signedBalanceDeltaCents:
                      direction === "income"
                        ? row.amount
                        : direction === "expense"
                          ? -row.amount
                          : null,
                  };
                }),
            };
          }),
        });
        return {
          ...result,
          statements: statements.map(present),
          asOf: now().toISOString(),
          timezone: owner.planningTimezone,
        };
      };
      return executor
        ? read(executor)
        : db.transaction(read, { isolationLevel: "repeatable read", accessMode: "read only" });
    },
  };
}
