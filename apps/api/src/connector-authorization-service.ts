import { createHash } from "node:crypto";
import { type Database, oauthStates } from "@personal-os/database";
import type {
  ConnectorAuthorizationOutcome,
  ConnectorAuthorizationProvider,
  ConnectorAuthorizationStatus,
  GoogleConnectionService,
} from "@personal-os/domain";
import { and, eq, gt, isNull, lt } from "drizzle-orm";
import { AppError } from "./errors.js";
import { decryptJson, encryptJson, generateToken, hashToken } from "./security.js";

const AUTHORIZATION_ATTEMPT_TTL_MS = 30 * 60_000;
const AUTHORIZATION_ATTEMPT_VISIBILITY_MS = 24 * 60 * 60_000;
const AUTHORIZATION_ATTEMPT_RETENTION_MS = 7 * 24 * 60 * 60_000;
const AUTHORIZATION_PROCESSING_LEASE_MS = 2 * 60_000;

type AuthorizationAttemptRow = typeof oauthStates.$inferSelect;
type ClosedAuthorizationStatus = Exclude<ConnectorAuthorizationStatus, "pending">;

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
  ): Promise<AuthorizationAttemptRow> {
    const completedAt = now();
    const [attempt] = await db
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
    async close(input: CloseAuthorizationAttemptInput): Promise<void> {
      await closeProcessingAttempt(input.attemptId, input);
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
      const [attempt] = await db
        .select()
        .from(oauthStates)
        .where(
          and(
            eq(oauthStates.id, attemptId),
            eq(oauthStates.userId, userId),
            gt(oauthStates.createdAt, visibleAfter),
          ),
        )
        .limit(1);
      if (!attempt || (attempt.completedAt && attempt.completedAt <= visibleAfter)) {
        throw new AppError("not_found", "The authorization attempt was not found.");
      }
      const status =
        attempt.status === "pending" || attempt.status === "processing"
          ? "pending"
          : attempt.status;
      return {
        accountId: attempt.connectedAccountId,
        provider: attempt.provider === "x" ? "x" : "google",
        retryable: attempt.outcomeCode ? retryableOutcomeCodes.has(attempt.outcomeCode) : false,
        status,
      };
    },

    async purgeExpired(): Promise<number> {
      const cutoff = new Date(now().getTime() - AUTHORIZATION_ATTEMPT_RETENTION_MS);
      const removed = await db
        .delete(oauthStates)
        .where(lt(oauthStates.expiresAt, cutoff))
        .returning({ id: oauthStates.id });
      return removed.length;
    },
  };
}
