import { z } from "zod";
import { type AccessScope, accessScopeSchema } from "./auth.js";
import { idSchema, isoDateTimeSchema } from "./common.js";

/** Wire validation only: these DTOs cannot establish a human, session, grant or live epoch. */
export const connectionTextingReadDisclosure =
  "Allow this connection to read Texting conversations and message contents across your account. This is broader than Finance notification-delivery details. It does not allow sending messages or changing Texting settings.";

const disclosureVersionSchema = z.literal("account_wide_texting_body_read_v1");
const maximumEpoch = 9_223_372_036_854_775_807n;
function epochValue(value: string): bigint | null {
  if (!/^(0|[1-9][0-9]{0,18})$/.test(value)) return null;
  const result = BigInt(value);
  return result <= maximumEpoch ? result : null;
}
export const connectionScopeEpochSchema = z
  .string()
  .max(19)
  .refine((value) => epochValue(value) !== null, "Use a canonical nonnegative database epoch.");

const scopesSchema = z
  .array(accessScopeSchema)
  .max(64)
  .refine((scopes) => new Set(scopes).size === scopes.length, "Scopes must be distinct.");
const addedReadScopesSchema = z.tuple([z.literal("texting:read")]);
const consentNonceSchema = z.string().regex(/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/);
const cursorSchema = z
  .string()
  .min(1)
  .max(512)
  .regex(/^[A-Za-z0-9_-]+$/);
function noAsciiControls(value: string): boolean {
  return [...value].every((character) => {
    const code = character.charCodeAt(0);
    return code >= 32 && code !== 127;
  });
}
function sameScopes(left: readonly AccessScope[], right: readonly AccessScope[]): boolean {
  return left.length === right.length && left.every((scope) => right.includes(scope));
}

export const connectionScopePermissionChangeSchema = z
  .object({
    baseScopes: scopesSchema,
    beforeScopes: scopesSchema,
    addedScopes: addedReadScopesSchema,
    afterScopes: scopesSchema,
  })
  .strict()
  .refine(
    (change) =>
      change.baseScopes.includes("finances:read") &&
      !change.baseScopes.includes("texting:read") &&
      sameScopes(change.baseScopes, change.beforeScopes) &&
      sameScopes(change.afterScopes, [...change.beforeScopes, "texting:read"]),
    "Retain the exact baseline with Finance read and add only Texting read.",
  );

export const connectionScopePrepareInputSchema = z
  .object({
    operationId: idSchema,
    expectedEpoch: connectionScopeEpochSchema,
    addScopes: addedReadScopesSchema,
  })
  .strict();
export const connectionScopeApprovalInputSchema = z
  .object({ consentNonce: consentNonceSchema, confirmed: z.literal(true) })
  .strict();
export const connectionScopePreparedIntentSchema = z
  .object({
    intentId: idSchema,
    connectionId: idSchema,
    operationId: idSchema,
    createdAt: isoDateTimeSchema,
    expiresAt: isoDateTimeSchema,
    expectedEpoch: connectionScopeEpochSchema,
    consentNonce: consentNonceSchema,
    disclosureVersion: disclosureVersionSchema,
    change: connectionScopePermissionChangeSchema,
  })
  .strict()
  .refine((intent) => {
    const duration = Date.parse(intent.expiresAt) - Date.parse(intent.createdAt);
    return duration > 0 && duration <= 300_000;
  }, "Prepared eligibility must be positive and at most five minutes; the server checks its live clock.");

const permissionSnapshotSchema = z
  .object({
    baseScopes: scopesSchema,
    effectiveScopes: scopesSchema,
    approvedAdditionalScopes: z.array(z.literal("texting:read")).max(1),
    epoch: connectionScopeEpochSchema,
    extensionState: z.enum(["absent", "active", "inactive"]),
    latestConsentId: idSchema.nullable(),
  })
  .strict()
  .refine((snapshot) => {
    const epoch = epochValue(snapshot.epoch);
    if (epoch === null) return false;
    if (snapshot.extensionState === "active")
      return (
        epoch > 0n &&
        snapshot.latestConsentId !== null &&
        snapshot.approvedAdditionalScopes.length === 1 &&
        snapshot.baseScopes.includes("finances:read") &&
        !snapshot.baseScopes.includes("texting:read") &&
        sameScopes(snapshot.effectiveScopes, [...snapshot.baseScopes, "texting:read"])
      );
    if (
      snapshot.approvedAdditionalScopes.length !== 0 ||
      !sameScopes(snapshot.effectiveScopes, snapshot.baseScopes)
    )
      return false;
    return snapshot.extensionState === "absent"
      ? epoch === 0n && snapshot.latestConsentId === null
      : epoch > 0n;
  }, "Permission metadata must distinguish an active receipt from baseline or inactive rights.");

const audienceSchema = z
  .string()
  .min(1)
  .max(2048)
  .refine((value) => {
    try {
      const url = new URL(value);
      return (
        (url.protocol === "https:" || url.protocol === "http:") &&
        !url.username &&
        !url.password &&
        !url.search &&
        !url.hash
      );
    } catch {
      return false;
    }
  }, "Use a credential-free exact HTTP audience without query or fragment.");

export const connectionScopeMetadataSchema = z
  .object({
    connectionId: idSchema,
    credentialKind: z.literal("oauth"),
    clientId: z
      .string()
      .min(1)
      .max(256)
      .refine(noAsciiControls, "Control characters are not allowed."),
    label: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .refine(noAsciiControls, "Control characters are not allowed."),
    audience: audienceSchema,
    permissions: permissionSnapshotSchema,
  })
  .strict();
export const connectionScopeMetadataListSchema = z
  .object({
    connections: z.array(connectionScopeMetadataSchema).max(20),
    nextCursor: cursorSchema.nullable(),
  })
  .strict()
  .refine(
    (page) =>
      new Set(page.connections.map((connection) => connection.connectionId)).size ===
      page.connections.length,
    "Do not merge or duplicate canonical connection identities.",
  );
/** Raw HTTP query format; no boolean/number coercion can change these bounds. */
export const connectionScopeListQuerySchema = z
  .object({
    limit: z
      .string()
      .regex(/^(?:[1-9]|1[0-9]|20)$/)
      .default("10")
      .transform(Number),
    cursor: cursorSchema.optional(),
  })
  .strict();

export const connectionScopeConsentReceiptSchema = z
  .object({
    id: idSchema,
    intentId: idSchema,
    connectionId: idSchema,
    operationId: idSchema,
    approvedAt: isoDateTimeSchema,
    previousEpoch: connectionScopeEpochSchema,
    approvedEpoch: connectionScopeEpochSchema,
    approvedBy: z.literal("human"),
    disclosureVersion: disclosureVersionSchema,
    change: connectionScopePermissionChangeSchema,
  })
  .strict()
  .refine((receipt) => {
    const previous = epochValue(receipt.previousEpoch);
    const approved = epochValue(receipt.approvedEpoch);
    return previous !== null && approved !== null && approved === previous + 1n;
  }, "One accepted intent advances the epoch exactly once without overflow.");

const unconsumedIntentStatusSchema = z
  .object({
    state: z.enum(["pending", "expired", "cancelled"]),
    intentId: idSchema,
    connectionId: idSchema,
    operationId: idSchema,
    expiresAt: isoDateTimeSchema,
  })
  .strict();
const consumedIntentStatusSchema = z
  .object({
    state: z.literal("consumed"),
    intentId: idSchema,
    connectionId: idSchema,
    operationId: idSchema,
    receipt: connectionScopeConsentReceiptSchema,
    current: z
      .object({
        epoch: connectionScopeEpochSchema,
        /** Whether THIS receipt still backs the live extension, not historical approval. */
        active: z.boolean(),
        reason: z.enum(["active", "revoked", "superseded", "unavailable"]),
      })
      .strict(),
  })
  .strict()
  .refine((status) => {
    const current = epochValue(status.current.epoch);
    const approved = epochValue(status.receipt.approvedEpoch);
    if (current === null || approved === null || current < approved) return false;
    if (
      status.intentId !== status.receipt.intentId ||
      status.connectionId !== status.receipt.connectionId ||
      status.operationId !== status.receipt.operationId
    )
      return false;
    if (status.current.active) return current === approved && status.current.reason === "active";
    return (
      status.current.reason !== "active" &&
      (status.current.reason === "unavailable" || current > approved)
    );
  }, "Known-intent readback must bind the receipt and distinguish historical approval from current authority.");

export const connectionScopeIntentStatusSchema = z.discriminatedUnion("state", [
  unconsumedIntentStatusSchema,
  consumedIntentStatusSchema,
]);

export type ConnectionScopePrepareInput = z.infer<typeof connectionScopePrepareInputSchema>;
export type ConnectionScopeApprovalInput = z.infer<typeof connectionScopeApprovalInputSchema>;
export type ConnectionScopePreparedIntent = z.infer<typeof connectionScopePreparedIntentSchema>;
export type ConnectionScopeMetadata = z.infer<typeof connectionScopeMetadataSchema>;
export type ConnectionScopeConsentReceipt = z.infer<typeof connectionScopeConsentReceiptSchema>;
export type ConnectionScopeIntentStatus = z.infer<typeof connectionScopeIntentStatusSchema>;
