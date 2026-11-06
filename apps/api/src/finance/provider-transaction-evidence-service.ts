import {
  accessTokens,
  type Database,
  financeAccounts,
  financeProviderItems,
  financeTransactions,
  sessions,
  users,
} from "@personal-os/database";
import {
  type FinanceProviderSourceAdmissionInput,
  type FinanceProviderTransactionEvidenceInput,
  financeProviderSourceAdmissionInputSchema,
  financeProviderTransactionEvidenceInputSchema,
  financeProviderTransactionEvidenceSchema,
  toCents,
} from "@personal-os/domain";
import { and, eq, inArray, sql } from "drizzle-orm";
import { AppError } from "../errors.js";
import type { createFinanceProviderItemService } from "../finance-provider-item-service.js";
import type { Principal } from "../types.js";
import type { FinanceTransaction } from "./context.js";
import { requireFinanceExecutionGuard } from "./execution-owner-guard.js";

type Options = {
  db: Database;
  now: () => Date;
  providerItems: Pick<
    ReturnType<typeof createFinanceProviderItemService>,
    "readTransactionHistory"
  >;
};
/** No writes, reconciliation or decisions. Network awaits never hold database locks/transactions. */
export function createFinanceProviderTransactionEvidenceService({
  db,
  now,
  providerItems,
}: Options) {
  const issued = new WeakMap<
    object,
    {
      ownerId: string;
      actorId: string;
      actorType: string;
      connectionId: string | undefined;
      fingerprint: string;
      targets: string;
    }
  >();
  const serializeNative = (value: unknown) =>
    JSON.stringify(value, (_, child) => (typeof child === "bigint" ? child.toString() : child));
  async function authorize(
    tx: Pick<Database, "select">,
    principal: Principal,
    sessionTokenHash?: string,
    lock = false,
  ) {
    if (!principal.scopes.has("finances:read"))
      throw new AppError("forbidden", "Finance read access is required.");
    const [owner] = await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, principal.userId));
    if (!owner) throw new AppError("forbidden", "Finance read authority is no longer active.");
    if (principal.actorType === "user") {
      if (!sessionTokenHash)
        throw new AppError(
          "forbidden",
          "Present the authenticated session to read historical evidence.",
        );
      const sessionQuery = tx
        .select({ expiresAt: sessions.expiresAt })
        .from(sessions)
        .where(
          and(eq(sessions.userId, principal.userId), eq(sessions.tokenHash, sessionTokenHash)),
        );
      const [session] = lock ? await sessionQuery.for("share") : await sessionQuery;
      if (!session || session.expiresAt <= now())
        throw new AppError("forbidden", "Finance read authority is no longer active.");
    }
    if (principal.actorType === "agent") {
      const tokenQuery = tx
        .select()
        .from(accessTokens)
        .where(
          and(eq(accessTokens.id, principal.actorId), eq(accessTokens.userId, principal.userId)),
        );
      const [token] = lock ? await tokenQuery.for("share") : await tokenQuery;
      if (
        !token ||
        token.revokedAt ||
        (token.expiresAt && token.expiresAt <= now()) ||
        !token.scopes.includes("finances:read") ||
        (principal.authorizationConnectionId !== undefined &&
          token.authorizationConnectionId !== principal.authorizationConnectionId)
      )
        throw new AppError("forbidden", "Finance read authority is no longer active.");
    }
  }
  async function snapshot(
    principal: Principal,
    ids: string[],
    sessionTokenHash?: string,
    executor?: FinanceTransaction,
  ) {
    if (!principal.scopes.has("finances:read"))
      throw new AppError("forbidden", "Finance read access is required.");
    const read = async (tx: Pick<Database, "select">) => {
      await authorize(tx, principal, sessionTokenHash);
      const rows = await tx
        .select({
          amount: financeTransactions.amount,
          currencyCode: financeTransactions.currencyCode,
          providerDirection: financeTransactions.providerDirection,
          transactionId: financeTransactions.id,
          transactionRevision: financeTransactions.contextualRevision,
          transactionUpdatedAt: financeTransactions.updatedAt,
          transactionUpdatedAtFence: sql<string>`${financeTransactions.updatedAt}::text`,
          providerTransactionId: financeTransactions.providerTransactionId,
          date: financeTransactions.transactionDate,
          accountId: financeAccounts.id,
          accountRevision: financeAccounts.contextualRevision,
          accountUpdatedAt: financeAccounts.updatedAt,
          accountUpdatedAtFence: sql<string>`${financeAccounts.updatedAt}::text`,
          providerAccountId: financeAccounts.providerAccountId,
          accountProviderItemId: financeAccounts.providerItemId,
          accountStatus: financeAccounts.status,
          provider: financeAccounts.provider,
          itemRecordId: financeProviderItems.id,
          providerItemId: financeProviderItems.providerItemId,
          itemUpdatedAt: financeProviderItems.updatedAt,
          itemUpdatedAtFence: sql<string>`${financeProviderItems.updatedAt}::text`,
          itemProvider: financeProviderItems.provider,
        })
        .from(financeTransactions)
        .innerJoin(
          financeAccounts,
          and(
            eq(financeTransactions.accountId, financeAccounts.id),
            eq(financeAccounts.userId, principal.userId),
          ),
        )
        .innerJoin(
          financeProviderItems,
          and(
            eq(financeAccounts.providerItemRecordId, financeProviderItems.id),
            eq(financeProviderItems.userId, principal.userId),
          ),
        )
        .where(
          and(
            eq(financeTransactions.userId, principal.userId),
            inArray(financeTransactions.id, ids),
          ),
        );
      if (rows.length !== ids.length)
        throw new AppError("not_found", "The native Finance selection is unavailable.");
      return rows.sort((a, b) => a.transactionId.localeCompare(b.transactionId));
    };
    return executor
      ? read(executor)
      : db.transaction(read, { isolationLevel: "repeatable read", accessMode: "read only" });
  }
  async function acquireSnapshot(
    principal: Principal,
    input: FinanceProviderTransactionEvidenceInput,
    sessionTokenHash?: string,
    expectedTargets?: FinanceProviderSourceAdmissionInput["targets"],
  ) {
    const before = await snapshot(principal, input.transactionIds, sessionTokenHash);
    if (
      expectedTargets &&
      before.some((row) => {
        const target = expectedTargets.find((entry) => entry.transactionId === row.transactionId);
        return (
          !target ||
          target.expectedTransactionRevision !== row.transactionRevision.toString() ||
          target.expectedAccountRevision !== row.accountRevision.toString()
        );
      })
    )
      throw new AppError("conflict", "The displayed Finance revisions changed.");
    const first = before[0];
    if (!first) throw new AppError("invalid_request", "A native Finance selection is required.");
    if (
      new Set(before.map((r) => r.itemRecordId)).size !== 1 ||
      new Set(before.map((r) => r.accountId)).size > 5
    )
      throw new AppError(
        "invalid_request",
        "Select at most five accounts on one Finance connection.",
      );
    if (
      before.some(
        (r) =>
          r.provider !== "plaid" ||
          r.itemProvider !== "plaid" ||
          r.accountStatus !== "connected" ||
          !r.providerAccountId ||
          !r.providerTransactionId ||
          !r.providerItemId ||
          r.accountProviderItemId !== r.providerItemId,
      )
    )
      throw new AppError("conflict", "The Finance source is not eligible for historical evidence.");
    const dates = before.map((r) => r.date).sort();
    const startDate = dates[0];
    const endDate = dates.at(-1);
    if (
      !startDate ||
      !endDate ||
      !/^\d{4}-\d{2}-\d{2}$/u.test(startDate) ||
      !/^\d{4}-\d{2}-\d{2}$/u.test(endDate) ||
      !Number.isFinite(Date.parse(startDate)) ||
      !Number.isFinite(Date.parse(endDate)) ||
      Date.parse(endDate) - Date.parse(startDate) >= 366 * 86_400_000
    )
      throw new AppError(
        "invalid_request",
        "Select a valid historical window shorter than 366 days.",
      );
    const targets = before.map((row) => {
      if (!row.providerAccountId || !row.providerTransactionId)
        throw new AppError("conflict", "The Finance source changed.");
      return { accountId: row.providerAccountId, transactionId: row.providerTransactionId };
    });
    const evidence = await providerItems.readTransactionHistory({
      userId: principal.userId,
      itemRecordId: first.itemRecordId,
      expectedUpdatedAt: first.itemUpdatedAt.toISOString(),
      targets,
      startDate,
      endDate,
    });
    const after = await snapshot(principal, input.transactionIds, sessionTokenHash);
    const serialize = (value: typeof before) =>
      JSON.stringify(value, (_, v) => (typeof v === "bigint" ? v.toString() : v));
    if (serialize(before) !== serialize(after))
      throw new AppError("conflict", "The Finance source changed during the provider read.");
    return { before, evidence };
  }
  return {
    /**
     * Server-private evidence, NOT mutation/execution authority or a durable receipt.
     * The canonical action caller resolves replay BEFORE acquisition and revalidates these native
     * snapshots under its existing authority/locks immediately before atomic admission.
     * Public read DTOs are never accepted as source proof. This method performs SELECTs only.
     */
    async acquireSourceFacts(
      principal: Principal,
      rawTargets: FinanceProviderSourceAdmissionInput["targets"],
      sessionTokenHash?: string,
    ) {
      const targets = financeProviderSourceAdmissionInputSchema.shape.targets.parse(rawTargets);
      const { before, evidence } = await acquireSnapshot(
        principal,
        { transactionIds: targets.map((target) => target.transactionId) },
        sessionTokenHash,
        targets,
      );
      if (
        !financeProviderTransactionEvidenceSchema.shape.observedAt.safeParse(evidence.observedAt)
          .success ||
        !financeProviderTransactionEvidenceSchema.shape.providerUpdatedAt.safeParse(
          evidence.providerUpdatedAt,
        ).success ||
        evidence.snapshotConsistency !== "not_atomic" ||
        evidence.coverage.scope !== "provider_available_window" ||
        evidence.coverage.state !== "complete" ||
        evidence.coverage.reason !== "exhausted" ||
        evidence.entries.length !== before.length
      )
        throw new AppError("conflict", "Historical source facts are not sufficiently proven.");
      const currencies = new Set(Intl.supportedValuesOf("currency"));
      // Validate EVERY requested target before returning any candidates; this function never writes.
      const facts = before.map((row) => {
        const matches = evidence.entries.filter(
          (entry) =>
            entry.accountId === row.providerAccountId &&
            entry.transactionId === row.providerTransactionId,
        );
        const entry = matches.length === 1 ? matches[0] : undefined;
        if (
          entry?.status !== "found" ||
          entry.sourceAmount === null ||
          !Number.isFinite(entry.sourceAmount) ||
          entry.sourceAmount === 0 ||
          !entry.currencyCode ||
          !currencies.has(entry.currencyCode) ||
          entry.date !== row.date ||
          entry.normalizedAmount !== Math.abs(entry.sourceAmount) ||
          entry.economicDirection !== (entry.sourceAmount < 0 ? "inflow" : "outflow")
        )
          throw new AppError("conflict", "Historical source facts are not sufficiently proven.");
        let sourceCents: number;
        try {
          sourceCents = toCents(Math.abs(entry.sourceAmount));
        } catch {
          throw new AppError("conflict", "Historical source amount is not exact native cents.");
        }
        const providerDirection =
          entry.sourceAmount < 0 ? ("income" as const) : ("expense" as const);
        if (
          sourceCents !== Math.abs(row.amount) ||
          (row.currencyCode !== null && row.currencyCode !== entry.currencyCode) ||
          (row.providerDirection !== null && row.providerDirection !== providerDirection)
        )
          throw new AppError(
            "conflict",
            "Existing Finance source facts conflict with provider evidence.",
          );
        return Object.freeze({
          transactionId: row.transactionId,
          accountId: row.accountId,
          transactionRevision: row.transactionRevision.toString(),
          accountRevision: row.accountRevision.toString(),
          currencyCode: entry.currencyCode,
          providerDirection,
          sourceAmount: entry.sourceAmount,
          date: entry.date,
        });
      });
      // These values remain inside the API service boundary; never serialize snapshots/provider IDs.
      const acquisition = Object.freeze({
        ownerId: principal.userId,
        observedAt: evidence.observedAt,
        providerUpdatedAt: evidence.providerUpdatedAt,
        snapshotConsistency: "not_atomic" as const,
        nativeSnapshot: before,
        facts: Object.freeze(facts),
      });
      issued.set(acquisition, {
        ownerId: principal.userId,
        actorId: principal.actorId,
        actorType: principal.actorType,
        connectionId: principal.authorizationConnectionId,
        fingerprint: serializeNative(before),
        targets: serializeNative(targets),
      });
      return acquisition;
    },
    async assertCurrentAuthority(
      principal: Principal,
      tx: FinanceTransaction,
      sessionTokenHash?: string,
    ) {
      await authorize(tx, principal, sessionTokenHash, true);
    },
    async revalidateSourceFacts(
      principal: Principal,
      targets: FinanceProviderSourceAdmissionInput["targets"],
      acquisition: object,
      tx: FinanceTransaction,
      sessionTokenHash?: string,
    ) {
      requireFinanceExecutionGuard(tx, principal.userId);
      const proof = issued.get(acquisition);
      if (
        !proof ||
        proof.ownerId !== principal.userId ||
        proof.actorId !== principal.actorId ||
        proof.actorType !== principal.actorType ||
        proof.connectionId !== principal.authorizationConnectionId ||
        proof.targets !== serializeNative(targets)
      )
        throw new AppError(
          "forbidden",
          "The source acquisition does not belong to this operation.",
        );
      await authorize(tx, principal, sessionTokenHash, true);
      const ids = targets.map((target) => target.transactionId).sort();
      const accountRefs = await tx
        .select({ id: financeTransactions.accountId })
        .from(financeTransactions)
        .where(
          and(
            eq(financeTransactions.userId, principal.userId),
            inArray(financeTransactions.id, ids),
          ),
        )
        .orderBy(financeTransactions.accountId);
      const accountIds = [...new Set(accountRefs.map((row) => row.id))].sort();
      const accounts = await tx
        .select()
        .from(financeAccounts)
        .where(
          and(
            eq(financeAccounts.userId, principal.userId),
            inArray(financeAccounts.id, accountIds),
          ),
        )
        .orderBy(financeAccounts.id)
        .for("update");
      const itemIds = [
        ...new Set(
          accounts.flatMap((row) => (row.providerItemRecordId ? [row.providerItemRecordId] : [])),
        ),
      ].sort();
      await tx
        .select({ id: financeProviderItems.id })
        .from(financeProviderItems)
        .where(
          and(
            eq(financeProviderItems.userId, principal.userId),
            inArray(financeProviderItems.id, itemIds),
          ),
        )
        .orderBy(financeProviderItems.id)
        .for("share");
      await tx
        .select({ id: financeTransactions.id })
        .from(financeTransactions)
        .where(
          and(
            eq(financeTransactions.userId, principal.userId),
            inArray(financeTransactions.id, ids),
          ),
        )
        .orderBy(financeTransactions.id)
        .for("update");
      const current = await snapshot(principal, ids, sessionTokenHash, tx);
      if (serializeNative(current) !== proof.fingerprint)
        throw new AppError("conflict", "The Finance source changed before admission.");
      return current;
    },
    async read(
      principal: Principal,
      rawInput: FinanceProviderTransactionEvidenceInput,
      sessionTokenHash?: string,
    ) {
      const input = financeProviderTransactionEvidenceInputSchema.parse(rawInput);
      const { before, evidence } = await acquireSnapshot(principal, input, sessionTokenHash);
      // Never spread a provider row. Native identity is authoritative; unexpected/duplicate provider rows fail closed.
      const entries = before.map((row) => {
        const matches = evidence.entries.filter(
          (entry) =>
            entry.accountId === row.providerAccountId &&
            entry.transactionId === row.providerTransactionId,
        );
        const entry = matches.length === 1 ? matches[0] : undefined;
        return {
          transactionId: row.transactionId,
          accountId: row.accountId,
          transactionRevision: row.transactionRevision.toString(),
          accountRevision: row.accountRevision.toString(),
          status: entry?.status ?? "unobserved",
          sourceAmount: entry?.sourceAmount ?? null,
          normalizedAmount: entry?.normalizedAmount ?? null,
          economicDirection: entry?.economicDirection ?? null,
          currencyCode: entry?.currencyCode ?? null,
          date: entry?.date ?? null,
        };
      });
      const mismatch =
        evidence.entries.length !== before.length ||
        before.some(
          (row) =>
            evidence.entries.filter(
              (e) =>
                e.accountId === row.providerAccountId &&
                e.transactionId === row.providerTransactionId,
            ).length !== 1,
        );
      try {
        return financeProviderTransactionEvidenceSchema.parse({
          observedAt: evidence.observedAt,
          providerUpdatedAt: evidence.providerUpdatedAt,
          snapshotConsistency: "not_atomic",
          coverage: mismatch ? "conflict" : evidence.coverage.state,
          reason: mismatch ? "identity_mismatch" : evidence.coverage.reason,
          entries,
        });
      } catch {
        throw new AppError("service_unavailable", "Historical provider evidence is invalid.");
      }
    },
  };
}
