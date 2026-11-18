import { createHash } from "node:crypto";
import {
  accessTokens,
  calendarAccounts,
  type Database,
  mailMessages,
  mailThreads,
} from "@personal-os/database";
import { idSchema, isoDateTimeSchema } from "@personal-os/domain";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { NodePgTransaction } from "drizzle-orm/node-postgres";
import { z } from "zod";
import { AppError } from "../errors.js";
import type { Principal } from "../types.js";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
const sourceSchema = z.strictObject({
  accountId: idSchema,
  threadId: idSchema,
  messageId: idSchema,
});
const versionSchema = z.strictObject({
  source: sourceSchema,
  threadUpdatedAt: isoDateTimeSchema,
  messageUpdatedAt: isoDateTimeSchema,
  providerRevision: z.string().max(4096).nullable(),
  contentSha256: z.string().regex(/^sha256:[a-f0-9]{64}$/),
});
const selectionSchema = z.strictObject({
  sources: z.array(sourceSchema).min(1).max(8),
  expected: z.array(versionSchema).max(8).optional(),
});
export type MailReceiptSourceRef = z.infer<typeof sourceSchema>;
export type MailReceiptSourceVersion = z.infer<typeof versionSchema>;
export type MailReceiptSourceSnapshot = Readonly<{
  schemaVersion: 1;
  source: MailReceiptSourceRef;
  version: MailReceiptSourceVersion;
  provider: string;
  receivedAt: string;
  bodyText: string;
}>;
const unavailable = () =>
  new AppError("not_found", "The requested Mail receipt sources are unavailable.");
const denied = () =>
  new AppError("forbidden", "Current Mail read access is required for receipt evidence.");
const changed = () =>
  new AppError("conflict", "Mail receipt sources changed. Refresh the exact evidence.");
function sameSource(a: MailReceiptSourceRef, b: MailReceiptSourceRef) {
  return a.accountId === b.accountId && a.threadId === b.threadId && a.messageId === b.messageId;
}
function requireTransaction(tx: Transaction): void {
  if (!(tx instanceof NodePgTransaction))
    throw new AppError(
      "internal_error",
      "Mail receipt evidence requires the caller-owned database transaction.",
    );
}

async function transactionIdentity(tx: Transaction) {
  const result = await tx.execute<{ id: string }>(sql`select pg_current_xact_id()::text as id`);
  const row = result.rows[0];
  if (!row) throw new Error("Transaction identity unavailable");
  return row.id;
}

async function decisionTime(tx: Transaction) {
  const result = await tx.execute<{ now: Date }>(sql`select clock_timestamp() as now`);
  const row = result.rows[0];
  if (!row) throw new Error("Decision clock unavailable");
  const value = new Date(row.now);
  if (!Number.isFinite(value.getTime())) throw new Error("Decision clock unavailable");
  return value;
}

/** Exact cached observations only, not purchase admission or immutable storage.
 * Caller owns the transaction, owner/token ordering, timeout and eventual Finance effect.
 * Source and grant SHARE locks remain held until that real transaction ends.
 */
export function createMailFinanceReceiptEvidenceReader() {
  return {
    async readLocked({
      tx,
      principal,
      sources,
      expected,
      signal,
    }: {
      tx: Transaction;
      principal: Principal;
      sources: readonly MailReceiptSourceRef[];
      expected?: readonly MailReceiptSourceVersion[];
      signal?: AbortSignal;
    }): Promise<readonly MailReceiptSourceSnapshot[]> {
      try {
        signal?.throwIfAborted();
        requireTransaction(tx);
        if (
          !principal.scopes.has("mail:read") ||
          (principal.actorType === "user" && principal.actorId !== principal.userId)
        )
          throw denied();
        const parsed = selectionSchema.safeParse({ sources, expected });
        if (
          !parsed.success ||
          new Set(sources.map((source) => source.messageId)).size !== sources.length
        )
          throw new AppError(
            "invalid_request",
            "Choose one to eight distinct exact Mail receipt sources.",
          );
        const refs = parsed.data.sources;
        const expectedById = new Map(
          parsed.data.expected?.map((version) => [version.source.messageId, version]),
        );
        if (
          parsed.data.expected &&
          (expectedById.size !== refs.length ||
            parsed.data.expected.length !== refs.length ||
            refs.some(
              (ref) =>
                !expectedById.has(ref.messageId) ||
                !sameSource(ref, expectedById.get(ref.messageId)?.source ?? ref),
            ))
        )
          throw changed();
        const transactionId = await transactionIdentity(tx);
        let expiry: Date | null = null;
        if (principal.actorType === "agent") {
          const [grant] = await tx
            .select({
              userId: accessTokens.userId,
              connectionId: accessTokens.authorizationConnectionId,
              scopes: accessTokens.scopes,
              expiresAt: accessTokens.expiresAt,
              revokedAt: accessTokens.revokedAt,
            })
            .from(accessTokens)
            .where(eq(accessTokens.id, principal.actorId))
            .for("share")
            .limit(1);
          if (
            !grant ||
            grant.userId !== principal.userId ||
            !principal.authorizationConnectionId ||
            grant.connectionId !== principal.authorizationConnectionId ||
            grant.revokedAt ||
            !grant.scopes.includes("mail:read")
          )
            throw denied();
          expiry = grant.expiresAt;
          if (expiry && expiry <= (await decisionTime(tx))) throw denied();
        }
        signal?.throwIfAborted();
        const accounts = await tx
          .select({ id: calendarAccounts.id, provider: calendarAccounts.provider })
          .from(calendarAccounts)
          .where(
            and(
              eq(calendarAccounts.userId, principal.userId),
              eq(calendarAccounts.mailEnabled, true),
              inArray(calendarAccounts.id, [...new Set(refs.map((ref) => ref.accountId))]),
            ),
          )
          .orderBy(asc(calendarAccounts.id))
          .for("share");
        const accountById = new Map(accounts.map((row) => [row.id, row]));
        if (refs.some((ref) => !accountById.has(ref.accountId))) throw unavailable();
        const threads = await tx
          .select({
            id: mailThreads.id,
            accountId: mailThreads.accountId,
            provider: mailThreads.provider,
            updatedAt: mailThreads.updatedAt,
          })
          .from(mailThreads)
          .where(
            and(
              eq(mailThreads.userId, principal.userId),
              isNull(mailThreads.deletedAt),
              inArray(
                mailThreads.accountId,
                accounts.map((account) => account.id),
              ),
              inArray(mailThreads.id, [...new Set(refs.map((ref) => ref.threadId))]),
            ),
          )
          .orderBy(asc(mailThreads.id))
          .for("share");
        const threadById = new Map(threads.map((row) => [row.id, row]));
        if (
          refs.some((ref) => {
            const thread = threadById.get(ref.threadId);
            return (
              !thread ||
              thread.accountId !== ref.accountId ||
              thread.provider !== accountById.get(ref.accountId)?.provider
            );
          })
        )
          throw unavailable();
        signal?.throwIfAborted();
        // Lock and size exact rows before transferring provider-controlled text.
        const metadata = await tx
          .select({
            id: mailMessages.id,
            threadId: mailMessages.threadId,
            bodyBytes: sql<number>`octet_length(${mailMessages.bodyText})`,
            remoteIdBytes: sql<number>`octet_length(${mailMessages.remoteMessageId})`,
            revisionBytes: sql<number>`coalesce(octet_length(${mailMessages.providerRevision}), 0)`,
          })
          .from(mailMessages)
          .where(
            and(
              inArray(
                mailMessages.threadId,
                threads.map((thread) => thread.id),
              ),
              inArray(
                mailMessages.id,
                refs.map((ref) => ref.messageId),
              ),
            ),
          )
          .orderBy(asc(mailMessages.id))
          .for("share");
        const metadataById = new Map(metadata.map((row) => [row.id, row]));
        if (refs.some((ref) => metadataById.get(ref.messageId)?.threadId !== ref.threadId))
          throw unavailable();
        let totalBytes = 0;
        for (const row of metadata) {
          totalBytes += row.bodyBytes;
          if (
            row.bodyBytes > 128 * 1024 ||
            totalBytes > 512 * 1024 ||
            row.remoteIdBytes > 4096 ||
            row.revisionBytes > 4096
          )
            throw new AppError(
              "invalid_request",
              "The selected Mail receipt content exceeds the read limit.",
            );
        }
        signal?.throwIfAborted();
        // These same rows cannot change while our caller retains their SHARE locks.
        const messages = await tx
          .select({
            id: mailMessages.id,
            remoteMessageId: mailMessages.remoteMessageId,
            bodyText: mailMessages.bodyText,
            providerRevision: mailMessages.providerRevision,
            receivedAt: mailMessages.receivedAt,
            updatedAt: mailMessages.updatedAt,
          })
          .from(mailMessages)
          .where(
            inArray(
              mailMessages.id,
              metadata.map((row) => row.id),
            ),
          );
        const messageById = new Map(messages.map((row) => [row.id, row]));
        const snapshots = refs.map((source) => {
          const message = messageById.get(source.messageId);
          const thread = threadById.get(source.threadId);
          const account = accountById.get(source.accountId);
          if (!message || !thread || !account) throw unavailable();
          const provider = account.provider;
          const identity = [
            1,
            principal.userId,
            source.accountId,
            source.threadId,
            source.messageId,
            provider,
            message.remoteMessageId,
            message.providerRevision,
            message.receivedAt.toISOString(),
            thread.updatedAt.toISOString(),
            message.updatedAt.toISOString(),
            message.bodyText,
          ];
          const contentSha256 = `sha256:${createHash("sha256").update("nohmi:mail-receipt-source:v1\0").update(JSON.stringify(identity)).digest("hex")}`;
          const version = {
            source,
            threadUpdatedAt: thread.updatedAt.toISOString(),
            messageUpdatedAt: message.updatedAt.toISOString(),
            providerRevision: message.providerRevision,
            contentSha256,
          };
          const prior = expectedById.get(source.messageId);
          if (
            prior &&
            (prior.threadUpdatedAt !== version.threadUpdatedAt ||
              prior.messageUpdatedAt !== version.messageUpdatedAt ||
              prior.providerRevision !== version.providerRevision ||
              prior.contentSha256 !== contentSha256)
          )
            throw changed();
          return {
            schemaVersion: 1 as const,
            source,
            version,
            provider,
            receivedAt: message.receivedAt.toISOString(),
            bodyText: message.bodyText,
          };
        });
        signal?.throwIfAborted();
        // Expiry may pass while waiting on a source lock even though revocation is serialized.
        if (expiry && expiry <= (await decisionTime(tx))) throw denied();
        if ((await transactionIdentity(tx)) !== transactionId)
          throw new AppError(
            "internal_error",
            "The caller-owned Mail evidence transaction has ended.",
          );
        return snapshots;
      } catch (error) {
        if (error instanceof AppError) throw error;
        const failure = new AppError(
          "service_unavailable",
          "Mail receipt sources could not be read. Retry the exact selection.",
        );
        failure.cause = error;
        throw failure;
      }
    },
  };
}
