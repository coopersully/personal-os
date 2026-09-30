import { createHash } from "node:crypto";
import { type Database, oauthStates } from "@personal-os/database";
import type {
  ConnectorAuthorizationOutcome,
  ConnectorAuthorizationProvider,
  ConnectorAuthorizationStatus,
  GoogleConnectionService,
} from "@personal-os/domain";
import { and, asc, eq, gt, inArray, isNull, lt, or } from "drizzle-orm";
import { AppError } from "./errors.js";
import { decryptJson, encryptJson, generateToken, hashToken } from "./security.js";

const AUTHORIZATION_ATTEMPT_TTL_MS = 30 * 60_000;
const AUTHORIZATION_ATTEMPT_VISIBILITY_MS = 24 * 60 * 60_000;
const AUTHORIZATION_ATTEMPT_RETENTION_MS = 7 * 24 * 60 * 60_000;
const AUTHORIZATION_PROCESSING_LEASE_MS = 2 * 60_000;
const AUTHORIZATION_PURGE_BATCH_SIZE = 1_000;

type AuthorizationAttemptRow = typeof oauthStates.$inferSelect;
type ClosedAuthorizationStatus = Exclude<ConnectorAuthorizationStatus, "pending">;
type AuthorizationDatabase = Pick<Database, "update">;

type CreateAuthorizationAttemptInput = {
  provider: ConnectorAuthorizationProvider;
  redirectUri: string;
  requestedServices: GoogleConnectionService[] | null;
  returnPath: "/setup" | "/settings?section=connections";
  targetAccountId: string | null;
  userId: string;
};

type CloseAuthorizationAttemptInput = {
  accountId: string | null;
  attemptId: string;
  outcomeCode: string;
  status: ClosedAuthorizationStatus;
};

type ConnectorAuthorizationServiceOptions = {
  db: Database;
  encryptionKey: string;
  now: () => Date;
};

const retryableOutcomeCodes = new Set([
  "authorization_interrupted",
  "provider_temporarily_unavailable",
  "provider_transport_failure",
]);

function publicAuthorizationProvider(provider: AuthorizationAttemptRow["provider"]) {
  switch (provider) {
    case "google":
    case "x":
      return provider;
    default:
      throw new AppError("not_found", "The authorization attempt was not found.");
  }
}

export function createConnectorAuthorizationService({
  db,
  encryptionKey,
  now,
}: ConnectorAuthorizationServiceOptions) {
  async function attemptByState(
    provider: ConnectorAuthorizationProvider,
    state: string,
  ): Promise<AuthorizationAttemptRow | null> {
    const [attempt] = await db
      .select()
      .from(oauthStates)
      .where(and(eq(oauthStates.provider, provider), eq(oauthStates.tokenHash, hashToken(state))))
      .limit(1);
    return attempt ?? null;
  }

  async function closeProcessingAttempt(
    attemptId: string,
    input: Omit<CloseAuthorizationAttemptInput, "attemptId">,
    executor: AuthorizationDatabase = db,
  ): Promise<AuthorizationAttemptRow> {
    const completedAt = now();
    const [attempt] = await executor
      .update(oauthStates)
      .set({
        completedAt,
        connectedAccountId: input.accountId,
        outcomeCode: input.outcomeCode,
        status: input.status,
      })
      .where(and(eq(oauthStates.id, attemptId), eq(oauthStates.status, "processing")))
      .returning();
    if (!attempt) {
      throw new AppError("conflict", "The authorization attempt is no longer processing.");
    }
    return attempt;
  }

  return {
    async close(
      input: CloseAuthorizationAttemptInput,
      executor: AuthorizationDatabase = db,
    ): Promise<void> {
      await closeProcessingAttempt(input.attemptId, input, executor);
    },

    async consume(
      provider: ConnectorAuthorizationProvider,
      state: string,
      requestId: string,
    ): Promise<
      | { attempt: AuthorizationAttemptRow; codeVerifier: string; kind: "ready" }
      | { attempt: AuthorizationAttemptRow; kind: "closed" }
      | { attempt: AuthorizationAttemptRow; kind: "expired" }
      | { attempt: AuthorizationAttemptRow; kind: "processing" }
      | { kind: "invalid" }
    > {
      const consumedAt = now();
      const [claimed] = await db
        .update(oauthStates)
        .set({ consumedAt, requestId, status: "processing" })
        .where(
          and(
            eq(oauthStates.provider, provider),
            eq(oauthStates.tokenHash, hashToken(state)),
            eq(oauthStates.status, "pending"),
            isNull(oauthStates.consumedAt),
            gt(oauthStates.expiresAt, consumedAt),
          ),
        )
        .returning();
      if (claimed) {
        if (!claimed.encryptedVerifier) {
          const closed = await closeProcessingAttempt(claimed.id, {
            accountId: null,
            outcomeCode: "authorization_verifier_missing",
            status: "failed",
          });
          return { attempt: closed, kind: "closed" };
        }
        return {
          attempt: claimed,
          codeVerifier: decryptJson<{ codeVerifier: string }>(
            claimed.encryptedVerifier,
            encryptionKey,
          ).codeVerifier,
          kind: "ready",
        };
      }

      const existing = await attemptByState(provider, state);
      if (!existing) return { kind: "invalid" };
      if (existing.status === "pending" && existing.expiresAt <= consumedAt) {
        const [expired] = await db
          .update(oauthStates)
          .set({
            completedAt: consumedAt,
            consumedAt,
            outcomeCode: "authorization_expired",
            requestId,
            status: "expired",
          })
          .where(and(eq(oauthStates.id, existing.id), eq(oauthStates.status, "pending")))
          .returning();
        if (expired) return { attempt: expired, kind: "expired" };
        const concurrent = await attemptByState(provider, state);
        return concurrent ? { attempt: concurrent, kind: "closed" } : { kind: "invalid" };
      }
      if (existing.status === "processing") {
        const staleBefore = new Date(consumedAt.getTime() - AUTHORIZATION_PROCESSING_LEASE_MS);
        if (existing.consumedAt && existing.consumedAt < staleBefore) {
          const [interrupted] = await db
            .update(oauthStates)
            .set({
              completedAt: consumedAt,
              outcomeCode: "authorization_interrupted",
              requestId,
              status: "failed",
            })
            .where(
              and(
                eq(oauthStates.id, existing.id),
                eq(oauthStates.status, "processing"),
                lt(oauthStates.consumedAt, staleBefore),
              ),
            )
            .returning();
          if (interrupted) return { attempt: interrupted, kind: "closed" };
        }
        const current = await attemptByState(provider, state);
        return current?.status === "processing"
          ? { attempt: current, kind: "processing" }
          : current
            ? { attempt: current, kind: "closed" }
            : { kind: "invalid" };
      }
      return { attempt: existing, kind: "closed" };
    },

    async create(input: CreateAuthorizationAttemptInput): Promise<{
      attemptId: string;
      codeChallenge: string;
      codeVerifier: string;
      state: string;
    }> {
      const state = generateToken("oauth");
      const codeVerifier = generateToken("pkce");
      const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");
      const [attempt] = await db
        .insert(oauthStates)
        .values({
          encryptedVerifier: encryptJson({ codeVerifier }, encryptionKey),
          expiresAt: new Date(now().getTime() + AUTHORIZATION_ATTEMPT_TTL_MS),
          provider: input.provider,
          redirectUri: input.redirectUri,
          requestedServices: input.requestedServices,
          returnPath: input.returnPath,
          targetAccountId: input.targetAccountId,
          tokenHash: hashToken(state),
          userId: input.userId,
        })
        .returning({ id: oauthStates.id });
      if (!attempt) {
        throw new AppError("internal_error", "The authorization attempt could not be created.");
      }
      return { attemptId: attempt.id, codeChallenge, codeVerifier, state };
    },

    async publicOutcome(userId: string, attemptId: string): Promise<ConnectorAuthorizationOutcome> {
      const visibleAfter = new Date(now().getTime() - AUTHORIZATION_ATTEMPT_VISIBILITY_MS);
      let [attempt] = await db
        .select()
        .from(oauthStates)
        .where(
          and(
            eq(oauthStates.id, attemptId),
            eq(oauthStates.userId, userId),
            or(
              and(isNull(oauthStates.completedAt), gt(oauthStates.createdAt, visibleAfter)),
              gt(oauthStates.completedAt, visibleAfter),
            ),
          ),
        )
        .limit(1);
      if (!attempt) {
        throw new AppError("not_found", "The authorization attempt was not found.");
      }
      if (attempt.status === "processing" && attempt.consumedAt) {
        const staleBefore = new Date(now().getTime() - AUTHORIZATION_PROCESSING_LEASE_MS);
        if (attempt.consumedAt < staleBefore) {
          const [interrupted] = await db
            .update(oauthStates)
            .set({
              completedAt: now(),
              outcomeCode: "authorization_interrupted",
              status: "failed",
            })
            .where(
              and(
                eq(oauthStates.id, attempt.id),
                eq(oauthStates.userId, userId),
                eq(oauthStates.status, "processing"),
                lt(oauthStates.consumedAt, staleBefore),
              ),
            )
            .returning();
          if (interrupted) {
            attempt = interrupted;
          } else {
            const [current] = await db
              .select()
              .from(oauthStates)
              .where(and(eq(oauthStates.id, attempt.id), eq(oauthStates.userId, userId)))
              .limit(1);
            if (!current) {
              throw new AppError("not_found", "The authorization attempt was not found.");
            }
            attempt = current;
          }
        }
      }
      const status =
        attempt.status === "pending" || attempt.status === "processing"
          ? "pending"
          : attempt.status;
      return {
        accountId: attempt.connectedAccountId,
        provider: publicAuthorizationProvider(attempt.provider),
        retryable: attempt.outcomeCode ? retryableOutcomeCodes.has(attempt.outcomeCode) : false,
        status,
      };
    },

    async purgeExpired(): Promise<number> {
      const cutoff = new Date(now().getTime() - AUTHORIZATION_ATTEMPT_RETENTION_MS);
      const expired = await db
        .select({ id: oauthStates.id })
        .from(oauthStates)
        .where(lt(oauthStates.expiresAt, cutoff))
        .orderBy(asc(oauthStates.expiresAt))
        .limit(AUTHORIZATION_PURGE_BATCH_SIZE);
      if (expired.length === 0) return 0;
      const removed = await db
        .delete(oauthStates)
        .where(
          inArray(
            oauthStates.id,
            expired.map((attempt) => attempt.id),
          ),
        )
        .returning({ id: oauthStates.id });
      return removed.length;
    },
  };
}
