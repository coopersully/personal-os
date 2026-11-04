import { describe, expect, it } from "vitest";
import {
  connectionScopeApprovalInputSchema,
  connectionScopeConsentReceiptSchema,
  connectionScopeEpochSchema,
  connectionScopeIntentStatusSchema,
  connectionScopeListQuerySchema,
  connectionScopeMetadataListSchema,
  connectionScopeMetadataSchema,
  connectionScopePermissionChangeSchema,
  connectionScopePreparedIntentSchema,
  connectionScopePrepareInputSchema,
  connectionTextingReadDisclosure,
} from "./authorization-connection-scopes.js";

const connectionId = "11111111-1111-4111-8111-111111111111";
const intentId = "22222222-2222-4222-8222-222222222222";
const operationId = "33333333-3333-4333-8333-333333333333";
const receiptId = "44444444-4444-4444-8444-444444444444";
const anotherId = "55555555-5555-4555-8555-555555555555";
const nonce = "A".repeat(43);
const change = {
  baseScopes: ["finances:read", "tasks:write"],
  beforeScopes: ["finances:read", "tasks:write"],
  addedScopes: ["texting:read"],
  afterScopes: ["finances:read", "tasks:write", "texting:read"],
};
const prepared = {
  intentId,
  connectionId,
  operationId,
  createdAt: "2026-11-04T12:00:00Z",
  expiresAt: "2026-11-04T12:05:00Z",
  expectedEpoch: "0",
  consentNonce: nonce,
  disclosureVersion: "account_wide_texting_body_read_v1",
  change,
};
const receipt = {
  id: receiptId,
  intentId,
  connectionId,
  operationId,
  approvedAt: "2026-11-04T12:01:00Z",
  previousEpoch: "0",
  approvedEpoch: "1",
  approvedBy: "human",
  disclosureVersion: "account_wide_texting_body_read_v1",
  change,
};
const metadata = {
  connectionId,
  credentialKind: "oauth",
  clientId: "existing-client",
  label: "Existing connection",
  audience: "https://example.com/mcp",
  permissions: {
    baseScopes: change.baseScopes,
    effectiveScopes: change.baseScopes,
    approvedAdditionalScopes: [],
    epoch: "0",
    extensionState: "absent",
    latestConsentId: null,
  },
};
const consumed = {
  state: "consumed",
  intentId,
  connectionId,
  operationId,
  receipt,
  current: { epoch: "1", active: true, reason: "active" },
};

describe("existing connection scope consent DTOs (not runtime authorization)", () => {
  it("preserves existing rights and adds only the expressly disclosed Texting read scope", () => {
    expect(connectionScopePermissionChangeSchema.parse(change)).toEqual(change);
    expect(connectionTextingReadDisclosure).toContain(
      "conversations and message contents across your account",
    );
    expect(connectionTextingReadDisclosure).toContain(
      "broader than Finance notification-delivery details",
    );
    expect(connectionTextingReadDisclosure).toContain("does not allow sending messages");
  });
  it.each([
    { ...change, beforeScopes: ["tasks:write"] },
    { ...change, baseScopes: ["tasks:write"] },
    { ...change, afterScopes: ["finances:read", "texting:read"] },
    { ...change, afterScopes: [...change.afterScopes, "texting:execute"] },
    { ...change, beforeScopes: [...change.beforeScopes, "texting:read"] },
    { ...change, afterScopes: [...change.afterScopes, "knowledge:read"] },
  ])("rejects missing baseline authority, dropped rights, preexisting additions and broader effects: %j", (value) => {
    expect(connectionScopePermissionChangeSchema.safeParse(value).success).toBe(false);
  });
  it.each([
    "texting:write",
    "texting:execute",
    "finances:write",
    "knowledge:read",
    "*",
  ])("never treats %s as the allowed delta", (scope) => {
    expect(
      connectionScopePrepareInputSchema.safeParse({
        operationId,
        expectedEpoch: "0",
        addScopes: [scope],
      }).success,
    ).toBe(false);
  });
  it.each([
    { addScopes: [] },
    { addScopes: ["texting:read", "texting:read"] },
    { addScopes: ["texting:read", "texting:write"] },
  ])("rejects an empty, duplicate or compound delta %j", ({ addScopes }) => {
    expect(
      connectionScopePrepareInputSchema.safeParse({ operationId, expectedEpoch: "0", addScopes })
        .success,
    ).toBe(false);
  });
  it.each([
    "ownerId",
    "principal",
    "sessionId",
    "authorizationSnapshot",
    "accessToken",
    "refreshToken",
  ])("rejects caller-supplied %s as consent authority", (field) => {
    expect(
      connectionScopePrepareInputSchema.safeParse({
        operationId,
        expectedEpoch: "0",
        addScopes: ["texting:read"],
        [field]: anotherId,
      }).success,
    ).toBe(false);
    expect(
      connectionScopeApprovalInputSchema.safeParse({
        consentNonce: nonce,
        confirmed: true,
        [field]: anotherId,
      }).success,
    ).toBe(false);
  });
  it("accepts the exact prepare command without manufacturing owner or session proof", () => {
    expect(
      connectionScopePrepareInputSchema.parse({
        operationId,
        expectedEpoch: "0",
        addScopes: ["texting:read"],
      }),
    ).toEqual({ operationId, expectedEpoch: "0", addScopes: ["texting:read"] });
  });
  it.each([
    0,
    -1,
    "-1",
    "01",
    "1.5",
    "1e3",
    "9223372036854775808",
    "x",
    "",
    "9".repeat(100),
  ])("fails closed without throwing on invalid epoch %j", (epoch) => {
    expect(() => connectionScopeEpochSchema.safeParse(epoch)).not.toThrow();
    expect(connectionScopeEpochSchema.safeParse(epoch).success).toBe(false);
  });
  it("keeps bigint epochs exact through the highest database value", () => {
    expect(connectionScopeEpochSchema.parse("9223372036854775807")).toBe("9223372036854775807");
  });
  it.each([
    false,
    "true",
    1,
    null,
  ])("requires a real explicit confirmation, not coercion: %j", (confirmed) => {
    expect(
      connectionScopeApprovalInputSchema.safeParse({ consentNonce: nonce, confirmed }).success,
    ).toBe(false);
  });
  it.each([
    "A".repeat(42),
    "A".repeat(44),
    "+".repeat(43),
    `${"A".repeat(42)}B`,
  ])("rejects a noncanonical consent nonce", (consentNonce) => {
    expect(
      connectionScopeApprovalInputSchema.safeParse({ consentNonce, confirmed: true }).success,
    ).toBe(false);
  });
  it("accepts the prepared five-minute interval and the exact confirmation shape", () => {
    expect(connectionScopePreparedIntentSchema.safeParse(prepared).success).toBe(true);
    expect(
      connectionScopeApprovalInputSchema.parse({ consentNonce: nonce, confirmed: true }),
    ).toEqual({ consentNonce: nonce, confirmed: true });
  });
  it.each([
    "2026-11-04T12:00:00Z",
    "2026-11-04T11:59:59Z",
    "2026-11-04T12:05:01Z",
  ])("rejects nonpositive or overlong prepared eligibility %s", (expiresAt) => {
    expect(connectionScopePreparedIntentSchema.safeParse({ ...prepared, expiresAt }).success).toBe(
      false,
    );
  });
  it("requires broad-read disclosure and canonical identifiers", () => {
    expect(
      connectionScopePreparedIntentSchema.safeParse({
        ...prepared,
        disclosureVersion: "notification_only",
      }).success,
    ).toBe(false);
    expect(
      connectionScopePrepareInputSchema.safeParse({
        operationId: "client-label",
        expectedEpoch: "0",
        addScopes: ["texting:read"],
      }).success,
    ).toBe(false);
  });
  it("distinguishes absent, approved and inactive permission state without changing token base scopes", () => {
    expect(connectionScopeMetadataSchema.safeParse(metadata).success).toBe(true);
    const approved = {
      ...metadata,
      permissions: {
        ...metadata.permissions,
        effectiveScopes: change.afterScopes,
        approvedAdditionalScopes: ["texting:read"],
        epoch: "1",
        extensionState: "active",
        latestConsentId: receiptId,
      },
    };
    expect(connectionScopeMetadataSchema.safeParse(approved).success).toBe(true);
    expect(
      connectionScopeMetadataSchema.safeParse({
        ...approved,
        permissions: {
          ...approved.permissions,
          effectiveScopes: change.baseScopes,
          approvedAdditionalScopes: [],
          epoch: "2",
          extensionState: "inactive",
        },
      }).success,
    ).toBe(true);
  });
  it.each([
    { ...metadata.permissions, effectiveScopes: change.afterScopes },
    { ...metadata.permissions, approvedAdditionalScopes: ["texting:read"] },
    { ...metadata.permissions, extensionState: "active", latestConsentId: receiptId },
    { ...metadata.permissions, extensionState: "inactive", epoch: "0" },
    { ...metadata.permissions, baseScopes: ["finances:read", "finances:read"] },
  ])("rejects contradictory or duplicate permission metadata", (permissions) => {
    expect(connectionScopeMetadataSchema.safeParse({ ...metadata, permissions }).success).toBe(
      false,
    );
  });
  it.each([
    "personal",
    "jwt",
    "unknown",
  ])("does not claim unsupported %s credential authority", (credentialKind) => {
    expect(connectionScopeMetadataSchema.safeParse({ ...metadata, credentialKind }).success).toBe(
      false,
    );
  });
  it.each([
    "https://user:password@example.com/mcp",
    "https://example.com/mcp#secret",
    "https://example.com/mcp?token=x",
    "file:///mcp",
  ])("rejects unsafe audience metadata", (audience) => {
    expect(connectionScopeMetadataSchema.safeParse({ ...metadata, audience }).success).toBe(false);
  });
  it("bounds list/query sizes and keeps unknown input fields out", () => {
    expect(connectionScopeListQuerySchema.parse({})).toEqual({ limit: 10 });
    expect(connectionScopeListQuerySchema.parse({ limit: "20" })).toEqual({ limit: 20 });
    for (const limit of ["0", "21", "true", true, 10])
      expect(connectionScopeListQuerySchema.safeParse({ limit }).success).toBe(false);
    expect(connectionScopeListQuerySchema.safeParse({ ownerId: anotherId }).success).toBe(false);
    expect(connectionScopeListQuerySchema.safeParse({ cursor: "a".repeat(513) }).success).toBe(
      false,
    );
    expect(
      connectionScopeMetadataListSchema.safeParse({
        connections: Array.from({ length: 21 }, () => metadata),
        nextCursor: null,
      }).success,
    ).toBe(false);
  });
  it("binds the historical receipt to the already-known intent and exact epoch increment", () => {
    expect(connectionScopeConsentReceiptSchema.safeParse(receipt).success).toBe(true);
    expect(connectionScopeIntentStatusSchema.safeParse(consumed).success).toBe(true);
    expect(
      connectionScopeIntentStatusSchema.safeParse({ ...consumed, intentId: anotherId }).success,
    ).toBe(false);
    expect(
      connectionScopeIntentStatusSchema.safeParse({ ...consumed, connectionId: anotherId }).success,
    ).toBe(false);
    expect(
      connectionScopeIntentStatusSchema.safeParse({ ...consumed, operationId: anotherId }).success,
    ).toBe(false);
    expect(
      connectionScopeConsentReceiptSchema.safeParse({ ...receipt, approvedEpoch: "2" }).success,
    ).toBe(false);
    expect(
      connectionScopeConsentReceiptSchema.safeParse({
        ...receipt,
        previousEpoch: "9223372036854775807",
        approvedEpoch: "0",
      }).success,
    ).toBe(false);
  });
  it("represents an expired intent and historical approval after later revocation without reactivation", () => {
    expect(
      connectionScopeIntentStatusSchema.safeParse({
        state: "expired",
        intentId,
        connectionId,
        operationId,
        expiresAt: prepared.expiresAt,
      }).success,
    ).toBe(true);
    const historical = { ...consumed, current: { epoch: "2", active: false, reason: "revoked" } };
    expect(connectionScopeIntentStatusSchema.safeParse(historical).success).toBe(true);
    expect(
      connectionScopeIntentStatusSchema.safeParse({
        ...historical,
        current: { epoch: "2", active: true, reason: "active" },
      }).success,
    ).toBe(false);
    expect(
      connectionScopeIntentStatusSchema.safeParse({
        ...consumed,
        current: { epoch: "0", active: false, reason: "revoked" },
      }).success,
    ).toBe(false);
    expect(
      connectionScopeIntentStatusSchema.safeParse({ ...historical, consentNonce: nonce }).success,
    ).toBe(false);
  });
  it("does not coerce an agent label or extra grant/secret fields into a human receipt", () => {
    expect(
      connectionScopeConsentReceiptSchema.safeParse({ ...receipt, approvedBy: "agent" }).success,
    ).toBe(false);
    expect(
      connectionScopeConsentReceiptSchema.safeParse({
        ...receipt,
        access_token: "fixture-not-a-credential",
      }).success,
    ).toBe(false);
    expect(
      connectionScopeIntentStatusSchema.safeParse({
        ...consumed,
        current: { ...consumed.current, principal: { actorType: "user" } },
      }).success,
    ).toBe(false);
  });
  it("does not mutate a frozen before/after capability snapshot while validating", () => {
    const frozen = Object.freeze({
      ...change,
      baseScopes: Object.freeze([...change.baseScopes]),
      beforeScopes: Object.freeze([...change.beforeScopes]),
      addedScopes: Object.freeze([...change.addedScopes]),
      afterScopes: Object.freeze([...change.afterScopes]),
    });
    expect(connectionScopePermissionChangeSchema.parse(frozen)).toEqual(change);
    expect(frozen.beforeScopes).toEqual(["finances:read", "tasks:write"]);
  });
});
