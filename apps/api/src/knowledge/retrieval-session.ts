import { createHash, createHmac } from "node:crypto";
import type { Database } from "@personal-os/database";
import {
  type AccessScope,
  type KnowledgePage,
  type KnowledgeQuery,
  type KnowledgeRecord,
  type KnowledgeRecordReference,
  knowledgeRecordReferenceSchema,
} from "@personal-os/domain";
import { z } from "zod";
import { AppError } from "../errors.js";
import { decryptJson, encryptJson } from "../security.js";
import type { Principal } from "../types.js";
import {
  createKnowledgeAccess,
  type KnowledgeTransaction,
  readKnowledgeEpoch,
  requireKnowledgeOwner,
} from "./access.js";

export type KnowledgeRetrievalDependencies = {
  db: Database;
  now: () => Date;
  encryptionKey: string;
};
export type KnowledgeAccess = ReturnType<typeof createKnowledgeAccess>;

export function retrievalFingerprint(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("base64url");
}

const cursorLifetimeMs = 15 * 60 * 1000;
const cursorCommon = { binding: z.string(), expiresAt: z.int() };
const cursorPayload = z.union([
  z.object({ ...cursorCommon, candidates: z.string(), offset: z.int().positive() }).strict(),
  z.object({ ...cursorCommon, start: knowledgeRecordReferenceSchema }).strict(),
]);

function changed() {
  return new AppError("conflict", "The memory page changed or expired. Start a fresh query.");
}

function cursorCodec(encryptionKey: string) {
  const secret = Buffer.from(encryptionKey, "base64");
  if (secret.length !== 32)
    throw new AppError("internal_error", "A valid application encryption key is required.");
  const key = createHmac("sha256", secret)
    .update("personal-os/knowledge/retrieval-cursor/v1")
    .digest("base64");
  return {
    encode(value: z.infer<typeof cursorPayload>) {
      const encrypted = encryptJson(value, key);
      return [encrypted.iv, encrypted.tag, encrypted.ciphertext].join(".");
    },
    decode(raw: string) {
      try {
        const segments = raw.split(".");
        if (
          segments.length !== 3 ||
          segments.some(
            (part) => !part || Buffer.from(part, "base64url").toString("base64url") !== part,
          )
        )
          throw changed();
        const [iv = "", tag = "", ciphertext = ""] = segments;
        if (iv.length !== 16 || tag.length !== 22) throw changed();
        return cursorPayload.parse(decryptJson<unknown>({ iv, tag, ciphertext, version: 1 }, key));
      } catch {
        throw changed();
      }
    },
  };
}

type RetrievalAdmission = {
  operation: "search" | "context" | "history" | "export" | "explain";
  filter?: unknown;
  cursor?: string | undefined;
  workspace?: KnowledgeQuery["workspace"];
  ownerOnly?: boolean;
};

export function createKnowledgeRetrievalSession({
  db,
  now,
  encryptionKey,
}: KnowledgeRetrievalDependencies) {
  let cursorEncryption: ReturnType<typeof cursorCodec> | undefined;
  const admission = createKnowledgeAccess(now);
  return function run<T>(
    principal: Principal,
    input: RetrievalAdmission,
    read: (session: KnowledgeRetrievalSession) => Promise<T>,
  ) {
    if (input.ownerOnly) requireKnowledgeOwner(principal);
    return db.transaction(async (tx) => {
      const { userId, actorId, actorType } = principal;
      const scopes: AccessScope[] = ["knowledge:read"];
      if (input.workspace) scopes.push(`${input.workspace}:read`);
      const { at, authority } = await admission.admit(tx, principal, scopes, "read");
      const access = createKnowledgeAccess(() => at);
      cursorEncryption ??= cursorCodec(encryptionKey);
      const codec = cursorEncryption;
      const epoch = await readKnowledgeEpoch(tx, userId);
      const binding = retrievalFingerprint([
        input.operation,
        userId,
        actorId,
        actorType,
        principal.sessionId ?? null,
        authority,
        epoch,
        input.filter ?? null,
      ]);
      const previous = input.cursor ? codec.decode(input.cursor) : null;
      if (previous && (previous.binding !== binding || previous.expiresAt <= at.getTime()))
        throw changed();
      const expiresAt = previous?.expiresAt ?? at.getTime() + cursorLifetimeMs;
      const result = await read({
        tx,
        at,
        access,
        epoch,
        authorizedScopes: authority.scopes,
        cursor(candidates) {
          if (previous && (!("candidates" in previous) || previous.candidates !== candidates))
            throw changed();
          return {
            offset: previous?.offset ?? 0,
            encode: (offset) =>
              codec.encode({
                binding,
                candidates,
                offset,
                expiresAt,
              }),
          };
        },
        historyCursor() {
          if (previous && !("start" in previous)) throw changed();
          return {
            start: previous?.start ?? null,
            encode: (start) => codec.encode({ binding, expiresAt, start }),
          };
        },
      });
      // Native source invalidation can advance the epoch outside the knowledge lock.
      if ((await readKnowledgeEpoch(tx, userId)) !== epoch) throw changed();
      return result;
    });
  };
}

export type KnowledgeRetrievalSession = {
  tx: KnowledgeTransaction;
  at: Date;
  access: KnowledgeAccess;
  epoch: number;
  authorizedScopes: AccessScope[];
  cursor(candidates: string): { offset: number; encode(offset: number): string };
  historyCursor(): {
    start: KnowledgeRecordReference | null;
    encode(position: KnowledgeRecordReference): string;
  };
};

export function pageAvailability(
  items: readonly unknown[],
  unavailable: boolean,
): KnowledgePage["state"] {
  return unavailable ? (items.length > 0 ? "partial" : "unavailable") : "available";
}

export function knowledgeRecordVisibility(record: KnowledgeRecord) {
  return [
    record.id,
    record.revision,
    record.status,
    record.conflictRecordIds,
    record.relatedRecordIds,
    record.supersededBy,
    record.tags,
    record.sources.map(({ id, availability }) => [id, availability ?? null]),
  ];
}

export function pageRecords(
  session: KnowledgeRetrievalSession,
  records: KnowledgeRecord[],
  unavailable: boolean,
  limit: number,
): KnowledgePage {
  const page = session.cursor(
    retrievalFingerprint([unavailable, records.map(knowledgeRecordVisibility)]),
  );
  const end = page.offset + limit;
  return {
    schemaVersion: 1,
    items: records.slice(page.offset, end),
    nextCursor: end < records.length ? page.encode(end) : null,
    epoch: session.epoch,
    state: pageAvailability(records, unavailable),
  };
}

export function knowledgeQueryFilter(input: KnowledgeQuery) {
  return [
    input.purpose ?? null,
    input.workspace ?? null,
    [...(input.entityRefs ?? [])].sort(),
    input.timeWindow ? [Date.parse(input.timeWindow.from), Date.parse(input.timeWindow.to)] : null,
    input.text ?? null,
    input.status ?? null,
    input.kind ?? null,
    input.origin ?? null,
    input.hasConflict ?? null,
    input.limit ?? 20,
    ...(input.reviewView ? [input.reviewView] : []),
    ...(input.tags ? [[...input.tags].sort(), input.tagMatch ?? "any"] : []),
  ];
}
