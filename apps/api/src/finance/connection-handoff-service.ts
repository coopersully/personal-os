import type { PlaidConnector } from "@personal-os/connectors";
import { type Database, financeAccountConnections } from "@personal-os/database";
import type { FinanceOutcome } from "@personal-os/domain";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { AppError } from "../errors.js";
import type { PlaidAccountIdentityMetadata } from "../finance-provider-item-service.js";
import { decryptJson, encryptJson } from "../security.js";
import type { RequestLog } from "../types.js";
import type { createFinanceAccountService } from "./account-service.js";
import {
  executeFinanceIdempotently,
  type FinanceMutationContext,
  type FinanceTransaction,
  requireFinanceExecution,
} from "./context.js";

const stateSchema = z.discriminatedUnion("phase", [
  z.object({ phase: z.literal("waiting"), linkToken: z.string() }),
  z.object({ phase: z.literal("exchanging") }),
  z.object({
    phase: z.literal("exchanged"),
    accessToken: z.string(),
    itemId: z.string(),
    institution: z.string().optional(),
  }),
]);
/** Provider consent remains human-owned. The server stores credentials and never asks an agent for tokens. */
export function createFinanceConnectionHandoffService(options: {
  db: Database;
  now: () => Date;
  encryptionKey?: string;
  log?: (entry: RequestLog) => void;
  plaid?: PlaidConnector;
  accounts: ReturnType<typeof createFinanceAccountService>;
  findDuplicateAccounts?: (
    userId: string,
    metadata: PlaidAccountIdentityMetadata[],
  ) => Promise<string[]>;
  preparePersistence: (
    item: { accessToken: string; itemId: string; institution?: string | undefined },
    context: FinanceMutationContext,
  ) => Promise<(executor: FinanceTransaction) => Promise<Array<{ id: string }>>>;
}) {
  const { db, now } = options;
  function provider() {
    if (
      !options.plaid?.createHostedLink ||
      !options.plaid.getHostedLinkResult ||
      !options.encryptionKey
    )
      throw new AppError("service_unavailable", "Hosted bank authorization is unavailable.");
    return {
      plaid: options.plaid,
      createHostedLink: options.plaid.createHostedLink.bind(options.plaid),
      getHostedLinkResult: options.plaid.getHostedLinkResult.bind(options.plaid),
      key: options.encryptionKey,
    };
  }
  async function owned(id: string, userId: string) {
    const row = await db.query.financeAccountConnections.findFirst({
      where: and(
        eq(financeAccountConnections.id, id),
        eq(financeAccountConnections.userId, userId),
      ),
    });
    if (!row) throw new AppError("not_found", "The bank connection was not found.");
    return row;
  }
  async function pending(id: string, userId: string, executor: Pick<Database, "select"> = db) {
    const read = await options.accounts.getConnection(userId, id, executor, true);
    const failed = read.data.status === "failed" || read.data.status === "needs_reauth";
    const connected = read.data.status === "connected";
    const outcome: FinanceOutcome = connected
      ? "completed"
      : failed
        ? "failed"
        : read.data.externalHandoff
          ? "external_action_required"
          : "work_remaining";
    return {
      ...read,
      outcome,
      communication: {
        ...read.communication,
        headline: connected
          ? "Bank connection completed."
          : (read.data.lastError?.message ??
            (read.data.externalHandoff
              ? "Complete bank authorization with the provider."
              : "Bank authorization is unavailable. Complete this connection to check its receipt; otherwise start a new attempt.")),
      },
      remainingWork: {
        categories: connected
          ? []
          : [
              failed
                ? "connection_restart"
                : read.data.externalHandoff
                  ? "provider_authorization"
                  : read.data.lastError?.code === "handoff_creation_pending"
                    ? "handoff_creation"
                    : "connection_recovery",
            ],
        count: connected ? 0 : 1,
      },
    };
  }
  return {
    async start(
      input: { provider: "plaid"; idempotencyKey: string },
      context: FinanceMutationContext,
    ) {
      await requireFinanceExecution(db, context, now());
      const { createHostedLink, key } = provider();
      let created = false;
      const receipt = await executeFinanceIdempotently(
        db,
        context,
        {
          operation: "finance.account_connection.start",
          idempotencyKey: input.idempotencyKey,
          payload: input,
        },
        async (tx) => {
          await requireFinanceExecution(tx, context, now());
          const [row] = await tx
            .insert(financeAccountConnections)
            .values({
              userId: context.userId,
              provider: "plaid",
              status: "pending",
              lastError: {
                code: "handoff_creation_pending",
                message:
                  "Provider link creation is in progress. If interrupted, start a new attempt; replay never repeats the provider request.",
                retryable: false,
              },
            })
            .returning();
          if (!row)
            throw new AppError("internal_error", "The bank connection could not be created.");
          created = true;
          return { data: { connectionId: row.id } };
        },
      );
      // The receipt and pending attempt are durable before contacting the provider.
      // A replay only reads this attempt; uncertain provider requests are never repeated.
      if (created) {
        let providerCompleted = false;
        const startedAt = Date.now();
        try {
          const link = await createHostedLink({
            clientName: "nohmi",
            countryCodes: ["US"],
            language: "en",
            linkCustomizationName: "default",
            products: ["transactions"],
            transactions: { daysRequested: 730 },
            userId: context.userId,
          });
          providerCompleted = true;
          await db
            .update(financeAccountConnections)
            .set({
              externalHandoffUrl: link.url,
              externalHandoffExpiresAt: new Date(link.expiresAt),
              encryptedHandoffState: encryptJson(
                { phase: "waiting", linkToken: link.linkToken },
                key,
              ),
              lastError: null,
              updatedAt: now(),
            })
            .where(eq(financeAccountConnections.id, receipt.data.connectionId));
        } catch {
          const code = providerCompleted ? "handoff_persistence_failed" : "provider_handoff_failed";
          // Emit only allowlisted metadata before attempting another database write. A
          // database outage must remain observable without logging a URL or token.
          options.log?.({
            event: "connector_handoff_failed",
            code,
            provider: "plaid",
            category: "unexpected",
            durationMs: Date.now() - startedAt,
            method: "POST",
            path: "/v1/finances/account-connections",
            requestId: context.requestId,
            status: 503,
          });
          await db
            .update(financeAccountConnections)
            .set({
              status: "failed",
              lastError: {
                code,
                message: providerCompleted
                  ? "A provider session was created but could not be saved. Its state is uncertain; do not reuse it. Wait for it to expire before starting a new connection attempt."
                  : "The provider authorization request failed and its result may be uncertain. Do not repeat this attempt; wait before starting a new connection attempt.",
                retryable: false,
              },
              updatedAt: now(),
            })
            .where(eq(financeAccountConnections.id, receipt.data.connectionId));
        }
      }
      const read = await pending(receipt.data.connectionId, context.userId);
      return {
        ...read,
        data: {
          connectionId: receipt.data.connectionId,
          status: read.data.status,
          externalHandoff: read.data.externalHandoff,
        },
      };
    },
    async complete(id: string, context: FinanceMutationContext) {
      await requireFinanceExecution(db, context, now());
      let row = await owned(id, context.userId);
      if (row.status === "connected") return options.accounts.getConnection(context.userId, id);
      const { plaid, getHostedLinkResult, key } = provider();
      if (!row.encryptedHandoffState)
        throw new AppError(
          "conflict",
          "The provider link was not created or was interrupted. Inspect this attempt and start a new hosted connection.",
        );
      let state = stateSchema.parse(decryptJson(row.encryptedHandoffState, key));
      if (state.phase === "waiting") {
        const result = await getHostedLinkResult(state.linkToken);
        if (result.publicTokens.length === 0) {
          if (row.externalHandoffExpiresAt && row.externalHandoffExpiresAt <= now()) {
            await db
              .update(financeAccountConnections)
              .set({
                status: "needs_reauth",
                encryptedHandoffState: null,
                externalHandoffUrl: null,
                lastError: {
                  code: "handoff_expired",
                  message: "Bank authorization expired. Start a new connection.",
                  retryable: false,
                },
                updatedAt: now(),
              })
              .where(
                and(
                  eq(financeAccountConnections.id, id),
                  eq(financeAccountConnections.version, row.version),
                ),
              );
          }
          return pending(id, context.userId);
        }
        if (result.publicTokens.length !== 1)
          throw new AppError(
            "conflict",
            "This hosted session returned multiple bank connections; start a single-bank session.",
          );
        const publicToken = result.publicTokens[0];
        if (!publicToken)
          throw new AppError("conflict", "The provider consent receipt is unavailable.");
        const metadata = result.accountMetadata?.[publicToken];
        if (metadata && options.findDuplicateAccounts) {
          const duplicateIds = await options.findDuplicateAccounts(
            context.userId,
            metadata.accounts.map((account) => ({
              ...account,
              institutionId: metadata.institutionId,
            })),
          );
          if (duplicateIds.length > 0) {
            await db
              .update(financeAccountConnections)
              .set({
                status: "failed",
                encryptedHandoffState: null,
                externalHandoffUrl: null,
                externalHandoffExpiresAt: null,
                lastError: {
                  code: "duplicate_bank_accounts",
                  message:
                    "These bank accounts are already connected. Review existing accounts before reconnecting.",
                  retryable: false,
                },
                updatedAt: now(),
              })
              .where(
                and(
                  eq(financeAccountConnections.id, id),
                  eq(financeAccountConnections.version, row.version),
                ),
              );
            throw new AppError(
              "conflict",
              "These bank accounts are already connected. Review existing accounts before reconnecting.",
              {
                reason: "duplicate_bank_accounts",
                accountIds: duplicateIds,
              },
            );
          }
        }
        const claimed = await db.transaction(async (tx) => {
          await tx
            .select({ id: financeAccountConnections.id })
            .from(financeAccountConnections)
            .where(
              and(
                eq(financeAccountConnections.id, id),
                eq(financeAccountConnections.userId, context.userId),
              ),
            )
            .for("update");
          await requireFinanceExecution(tx, context, now());
          const [accepted] = await tx
            .update(financeAccountConnections)
            .set({
              encryptedHandoffState: encryptJson({ phase: "exchanging" }, key),
              externalHandoffUrl: null,
              externalHandoffExpiresAt: null,
              version: row.version + 1,
              updatedAt: now(),
              lastError: {
                code: "exchange_in_progress",
                message:
                  "Provider consent is being exchanged. An interrupted exchange must not be retried blindly.",
                retryable: false,
              },
            })
            .where(
              and(
                eq(financeAccountConnections.id, id),
                eq(financeAccountConnections.version, row.version),
              ),
            )
            .returning();
          return accepted;
        });
        if (!claimed)
          throw new AppError(
            "conflict",
            "This connection is already being completed. Reload its status.",
          );
        row = claimed;
        let exchanged: { accessToken: string; itemId: string };
        try {
          exchanged = await plaid.exchangePublicToken(publicToken);
        } catch (error) {
          await db
            .update(financeAccountConnections)
            .set({
              status: "needs_reauth",
              lastError: {
                code: "exchange_uncertain",
                message:
                  "The bank authorization exchange could not be confirmed. Start a new authorization; do not retry its consumed token.",
                retryable: false,
              },
              updatedAt: now(),
            })
            .where(eq(financeAccountConnections.id, id));
          throw error;
        }
        state = {
          phase: "exchanged",
          ...exchanged,
          ...(result.institutions?.[publicToken]
            ? { institution: result.institutions[publicToken] }
            : {}),
        };
        const encryptedState = encryptJson(state, key);
        const persistenceStartedAt = Date.now();
        // Reuse the known result; the single-use provider exchange must never be repeated.
        for (let attempt = 0; attempt < 3; attempt += 1) {
          try {
            const [persisted] = await db
              .update(financeAccountConnections)
              .set({ encryptedHandoffState: encryptedState, lastError: null, updatedAt: now() })
              .where(
                and(
                  eq(financeAccountConnections.id, id),
                  eq(financeAccountConnections.userId, context.userId),
                  eq(financeAccountConnections.version, claimed.version),
                  eq(financeAccountConnections.status, "pending"),
                ),
              )
              .returning({ id: financeAccountConnections.id });
            if (!persisted)
              throw new AppError(
                "conflict",
                "The bank connection changed while saving its exchange.",
              );
            break;
          } catch {
            if (attempt < 2) continue;
            options.log?.({
              event: "connector_handoff_failed",
              code: "exchange_persistence_failed",
              provider: "plaid",
              category: "unexpected",
              durationMs: Date.now() - persistenceStartedAt,
              method: "POST",
              path: "/v1/finances/account-connections/:id/complete",
              requestId: context.requestId,
              status: 503,
            });
            await db
              .update(financeAccountConnections)
              .set({
                status: "needs_reauth",
                lastError: {
                  code: "exchange_persistence_failed",
                  message:
                    "Provider authorization completed, but its credentials could not be saved after bounded retries. This attempt needs recovery; do not repeat its consumed token.",
                  retryable: false,
                },
                updatedAt: now(),
              })
              .where(
                and(
                  eq(financeAccountConnections.id, id),
                  eq(financeAccountConnections.version, claimed.version),
                ),
              );
            throw new AppError(
              "service_unavailable",
              "Provider authorization completed, but its credentials could not be retained. Inspect connection recovery before reconnecting.",
            );
          }
        }
      }
      if (state.phase === "exchanging")
        throw new AppError(
          "conflict",
          "Bank token exchange is in progress or uncertain. Read connection status; an interrupted exchange requires fresh provider authorization.",
        );
      if (state.phase !== "exchanged") return pending(id, context.userId);
      // Reusing a durably stored exchange result never repeats the single-use provider exchange.
      await requireFinanceExecution(db, context, now());

      const exchanged = state;
      try {
        const persist = await options.preparePersistence(exchanged, context);
        await db.transaction(async (tx) => {
          const [current] = await tx
            .select()
            .from(financeAccountConnections)
            .where(
              and(
                eq(financeAccountConnections.id, id),
                eq(financeAccountConnections.userId, context.userId),
              ),
            )
            .for("update");
          if (!current) throw new AppError("not_found", "The bank connection was not found.");
          if (current.status === "connected") return;
          if (
            !current.encryptedHandoffState ||
            stateSchema.parse(decryptJson(current.encryptedHandoffState, key)).phase !== "exchanged"
          )
            throw new AppError("conflict", "The bank connection changed. Reload its status.");
          await requireFinanceExecution(tx, context, now());
          const accounts = await persist(tx);
          await tx
            .update(financeAccountConnections)
            .set({
              status: "connected",
              accountIds: accounts.map((account) => account.id),
              encryptedHandoffState: null,
              externalHandoffUrl: null,
              externalHandoffExpiresAt: null,
              lastError: null,
              version: current.version + 1,
              updatedAt: now(),
            })
            .where(eq(financeAccountConnections.id, id));
        });
      } catch (error) {
        const duplicate =
          error instanceof AppError &&
          error.code === "conflict" &&
          typeof error.details === "object" &&
          error.details !== null &&
          "reason" in error.details &&
          error.details.reason === "duplicate_bank_accounts";
        await db
          .update(financeAccountConnections)
          .set({
            ...(duplicate ? { status: "failed" as const } : {}),
            lastError: {
              code: duplicate ? "duplicate_bank_accounts" : "connection_persist_failed",
              message: duplicate
                ? "These bank accounts are already connected. Provider authorization was retained securely for recovery; review existing accounts before reconnecting."
                : "Authorized bank details were retained securely. Retry completion to save the accounts; provider consent will not be exchanged again.",
              retryable: !duplicate,
            },
            updatedAt: now(),
          })
          .where(
            and(
              eq(financeAccountConnections.id, id),
              eq(financeAccountConnections.status, "pending"),
            ),
          );
        throw error;
      }
      return options.accounts.getConnection(context.userId, id);
    },
  };
}
