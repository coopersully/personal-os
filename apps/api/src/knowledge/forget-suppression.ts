import { createHmac, timingSafeEqual } from "node:crypto";
import { knowledgeForgetSuppressions } from "@personal-os/database";
import { and, eq, ne } from "drizzle-orm";
import { AppError } from "../errors.js";
import type { Principal } from "../types.js";
import { type KnowledgeTransaction, requireLiveKnowledgeHumanSession } from "./access.js";

function fingerprint(key: Uint8Array, purpose: string, userId: string, claimKey?: string) {
  return createHmac("sha256", key)
    .update(JSON.stringify(["knowledge-forgetting-v1", purpose, userId, claimKey ?? null]))
    .digest("hex");
}

export function knowledgeForgetKeyProof(key: Uint8Array, userId: string) {
  return fingerprint(key, "key-proof", userId);
}

export function knowledgeForgetFingerprint(key: Uint8Array, userId: string, claimKey: string) {
  return fingerprint(key, "claim", userId, claimKey);
}

export function knowledgeForgetReplayVerifier(
  key: Uint8Array,
  userId: string,
  mutationKey: string,
  requestHash: string,
) {
  return fingerprint(
    key,
    "receipt-replay",
    userId,
    JSON.stringify([mutationKey.toLowerCase(), requestHash]),
  );
}

export function matchesKnowledgeForgetReplay(
  verifier: string | null,
  key: Uint8Array | undefined,
  userId: string,
  mutationKey: string,
  requestHash: string,
) {
  if (!validKnowledgeForgetKey(key) || verifier === null)
    throw new AppError("service_unavailable", "The forgotten receipt cannot be verified.");
  const expected = Buffer.from(
    knowledgeForgetReplayVerifier(key, userId, mutationKey, requestHash),
  );
  const actual = Buffer.from(verifier);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function validKnowledgeForgetKey(key: Uint8Array | undefined): key is Uint8Array {
  return key !== undefined && key.byteLength >= 32;
}

export async function assertKnowledgeForgetKey(
  tx: KnowledgeTransaction,
  userId: string,
  key: Uint8Array | undefined,
) {
  const [mismatch] = await tx
    .select({ fingerprint: knowledgeForgetSuppressions.fingerprint })
    .from(knowledgeForgetSuppressions)
    .where(
      and(
        eq(knowledgeForgetSuppressions.userId, userId),
        validKnowledgeForgetKey(key)
          ? ne(knowledgeForgetSuppressions.keyProof, knowledgeForgetKeyProof(key, userId))
          : undefined,
      ),
    )
    .limit(1);
  if (mismatch)
    throw new AppError("service_unavailable", "Knowledge suppression is temporarily unavailable.");
}

export async function hasKnowledgeForgetSuppression(
  tx: KnowledgeTransaction,
  userId: string,
  key: Uint8Array | undefined,
  claimKey: string | null,
) {
  await assertKnowledgeForgetKey(tx, userId, key);
  if (!claimKey || !validKnowledgeForgetKey(key)) return false;
  const [row] = await tx
    .select({ fingerprint: knowledgeForgetSuppressions.fingerprint })
    .from(knowledgeForgetSuppressions)
    .where(
      and(
        eq(knowledgeForgetSuppressions.userId, userId),
        eq(
          knowledgeForgetSuppressions.fingerprint,
          knowledgeForgetFingerprint(key, userId, claimKey),
        ),
      ),
    );
  return row !== undefined;
}

export async function admitKnowledgeClaim(
  tx: KnowledgeTransaction,
  {
    principal,
    claimKey,
    key,
    explicitReadd,
    at,
  }: {
    principal: Principal;
    claimKey: string | null;
    key: Uint8Array | undefined;
    explicitReadd: boolean;
    at: Date;
  },
) {
  const { userId } = principal;
  if (!(await hasKnowledgeForgetSuppression(tx, userId, key, claimKey))) return;
  if (!explicitReadd || !claimKey || !validKnowledgeForgetKey(key))
    throw new AppError(
      "conflict",
      "Only the account owner can explicitly re-add forgotten knowledge.",
    );
  await requireLiveKnowledgeHumanSession(tx, principal, at);
  await tx
    .delete(knowledgeForgetSuppressions)
    .where(
      and(
        eq(knowledgeForgetSuppressions.userId, userId),
        eq(
          knowledgeForgetSuppressions.fingerprint,
          knowledgeForgetFingerprint(key, userId, claimKey),
        ),
      ),
    );
}
