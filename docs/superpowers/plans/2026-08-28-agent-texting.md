# Agent Texting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give each ilo account one verified SMS conversation that authorized agents can read and answer through two safe MCP tools backed by a shared Twilio toll-free number.

**Architecture:** Add Texting as a vertical domain: canonical contracts in `packages/domain`, five durable PostgreSQL tables and a repository in `packages/database`, all Twilio behavior behind `packages/connectors`, policy and orchestration in `apps/api`, a typed client shared by the web and MCP surfaces, and a human-only Settings panel. MCP remains stateless; Twilio webhooks enter through dedicated unauthenticated routes whose provider authentication is independent from ilo sessions.

**Tech Stack:** TypeScript 5.8, Zod 4, Drizzle/PostgreSQL 17, Hono, Twilio Programmable Messaging and Verify, React 19, TanStack Query, shadcn/Base UI, MCP SDK 1.29, Vitest, Testing Library, and Playwright.

**Spec:** `docs/superpowers/specs/2026-08-28-agent-texting-design.md`

## Global Constraints

- Use one shared, verified Twilio toll-free sender for US and Canada; never accept caller-controlled `To`, `From`, Messaging Service, or provider values.
- Permit one active verified number per account and one active account per deterministic phone fingerprint.
- Keep phone setup, replacement, disconnect, and conversation deletion human-session-only.
- Require `texting:read` for conversation access and both `texting:read` and `texting:write` for sending.
- Require a newest-page conversation receipt, bound to user, access token, consent epoch, time zone, revision, and a five-minute expiry, before every send.
- A successful send consumes the receipt by advancing the conversation revision; length-review stops do not consume it.
- Default to one outbound bubble; permit a server-tracked series of two or three bubbles only for `structured_data` or `requested_large_content`.
- Treat 1–2 segments as normal, 3 as measured normal, 4–6 as review-gated, 7–10 as exceptionally gated, and more than 10 as forbidden.
- Enforce 5 outbound bubbles per rolling minute and 100 outbound segments per rolling 24 hours per account before calling Twilio.
- Preserve every message's ISO timestamp and render every message plus the current instant in the caller's effective IANA time zone.
- Twilio STOP filtering is authoritative. Local state must fail closed on authenticated STOP events, error `21610`, provider synchronization uncertainty, administrative suspension, or disabled outbound service; only handset-originated authenticated START reactivates.
- Store no OTP, raw provider webhook payload, full phone number, message body, secret, or free-text length justification in logs, metrics, or audit snapshots.
- Version 1 is asynchronous plain SMS only: no MMS, web chat, real-time wakeup, scheduling, arbitrary recipients, unread state, or Conversations API.
- Keep all provider calls in `packages/connectors`; web and MCP call only `@personal-os/api-client`.
- Use a deterministic fake Twilio adapter for automated tests; no automated test uses real provider credentials or network calls.
- Run focused tests after each task and `pnpm verify` before final handoff.

---

### Task 1: Canonical Texting Contracts, Scopes, and Ownership

**Files:**
- Create: `packages/domain/src/texting.ts`
- Create: `packages/domain/src/texting.test.ts`
- Modify: `packages/domain/src/auth.ts`
- Modify: `packages/domain/src/feature-contracts.ts`
- Modify: `packages/domain/src/index.ts`
- Modify: `packages/domain/package.json`
- Modify: `apps/api/src/auth-service.ts`
- Modify: `apps/api/src/oauth-service.ts`
- Modify: `packages/domain/src/domain.test.ts`
- Modify: `docs/engineering/feature-ownership.md`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Consumes: existing `idSchema`, `isoDateTimeSchema`, `timeZoneSchema`, `AccessScope`, `AgentActionContract`, and Zod conventions.
- Produces: all public Texting schemas/types; `normalizeTextingPhoneNumber`; `texting:read` and `texting:write`; `featureAccessPolicies.texting`; and the Texting ownership boundary used by every later task.

- [ ] **Step 1: Add failing domain tests for phone normalization, scopes, states, pagination, and send inputs**

```ts
import {
  createAccessTokenInputSchema,
  normalizeTextingPhoneNumber,
  sendTextMessageInputSchema,
  textConversationQuerySchema,
  textingConnectionStateSchema,
} from "./index.js";

it("normalizes only US and Canadian NANP numbers", () => {
  expect(normalizeTextingPhoneNumber({ country: "US", phoneNumber: "(212) 555-0123" })).toEqual({
    country: "US",
    e164: "+12125550123",
    lastFour: "0123",
  });
  expect(() => normalizeTextingPhoneNumber({ country: "US", phoneNumber: "+442071838750" })).toThrow();
});

it("requires texting read whenever texting write is granted", () => {
  expect(() =>
    createAccessTokenInputSchema.parse({ name: "SMS agent", scopes: ["texting:write"] }),
  ).toThrow("texting:read");
});

it("bounds cursor and outbound contracts", () => {
  expect(textConversationQuerySchema.parse({})).toEqual({ limit: 100 });
  expect(() => textConversationQuerySchema.parse({ afterCursor: "a", beforeCursor: "b" })).toThrow();
  expect(textingConnectionStateSchema.parse("opted_out")).toBe("opted_out");
  expect(sendTextMessageInputSchema.parse({ body: "Done.", conversationReceipt: "receipt" })).toMatchObject({
    contentKind: "concise",
  });
});
```

- [ ] **Step 2: Run the domain tests and confirm the new exports do not exist**

Run: `pnpm vitest run packages/domain/src/texting.test.ts packages/domain/src/domain.test.ts`

Expected: FAIL because `texting.ts`, the Texting schemas, and the two scopes are absent.

- [ ] **Step 3: Add the canonical contract and phone normalizer**

Add `libphonenumber-js` to `@personal-os/domain`, then define these exact public shapes in `texting.ts`:

```ts
export const textingCountrySchema = z.enum(["US", "CA"]);
export const textingConnectionStateSchema = z.enum([
  "active",
  "opted_out",
  "sync_error",
  "suspended",
  "disconnected",
]);
export const textMessageDirectionSchema = z.enum(["inbound", "outbound"]);
export const textMessageStatusSchema = z.enum([
  "accepted",
  "queued",
  "sending",
  "sent",
  "delivered",
  "undelivered",
  "failed",
  "unknown",
]);
export const textContentKindSchema = z.enum([
  "concise",
  "essential_context",
  "structured_data",
  "requested_large_content",
  "safety_critical",
]);
export const textingConnectionSchema = z.object({
  country: textingCountrySchema.nullable(),
  id: idSchema.nullable(),
  maskedPhoneNumber: z.string().nullable(),
  consentEpoch: z.int().nonnegative(),
  state: textingConnectionStateSchema.nullable(),
  verifiedAt: isoDateTimeSchema.nullable(),
  senderPhoneNumber: z.string().nullable(),
  providerReady: z.boolean(),
});
export const textMessageSchema = z.object({
  actualSegments: z.int().positive().nullable(),
  contentKind: textContentKindSchema.nullable(),
  deliveredAt: isoDateTimeSchema.nullable(),
  direction: textMessageDirectionSchema,
  id: idSchema,
  localDateTime: z.string().min(1),
  occurredAt: isoDateTimeSchema,
  occurredAtSource: z.enum(["provider", "ilo"]),
  predictedSegments: z.int().positive().nullable(),
  sentAt: isoDateTimeSchema.nullable(),
  seriesId: z.uuid().nullable(),
  seriesPart: z.int().min(1).max(3).nullable(),
  seriesTotal: z.int().min(2).max(3).nullable(),
  status: textMessageStatusSchema,
  text: z.string(),
});
export const textConversationPageSchema = z.object({
  asOf: isoDateTimeSchema,
  connection: textingConnectionSchema,
  conversationReceipt: z.string().nullable(),
  currentLocalDateTime: z.string().min(1),
  earlierCursor: z.string().nullable(),
  hasEarlierMessages: z.boolean(),
  messages: z.array(textMessageSchema),
  newerCursor: z.string().nullable(),
  timeZone: timeZoneSchema,
});
export const textConversationQuerySchema = z
  .object({
    afterCursor: z.string().min(1).optional(),
    beforeCursor: z.string().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(100),
  })
  .refine((value) => !(value.afterCursor && value.beforeCursor), {
    message: "Use either afterCursor or beforeCursor, not both.",
  });
export const sendTextMessageInputSchema = z.object({
  body: z.string().trim().min(1).max(1_600),
  contentKind: textContentKindSchema.default("concise"),
  conversationReceipt: z.string().min(1),
  exceptionalLengthToken: z.string().min(1).optional(),
  lengthReviewToken: z.string().min(1).optional(),
  necessity: z.string().trim().min(1).max(240).optional(),
  seriesId: z.uuid().optional(),
  seriesPart: z.int().min(2).max(3).optional(),
  seriesTotal: z.int().min(2).max(3).optional(),
});
export const textingConsentVersion = "2026-08-28-v1" as const;
export const startTextingVerificationInputSchema = z.object({
  consentAccepted: z.literal(true),
  country: textingCountrySchema,
  phoneNumber: z.string().trim().min(7).max(32),
});
export const checkTextingVerificationInputSchema = z.object({
  code: z.string().regex(/^\d{4,10}$/),
});
export const textingVerificationChallengeSchema = z.object({
  expiresAt: isoDateTimeSchema,
  id: idSchema,
  maskedPhoneNumber: z.string(),
  status: z.enum(["pending", "approved", "expired", "failed", "cancelled"]),
});
export type CheckTextingVerificationInput = z.infer<typeof checkTextingVerificationInputSchema>;
export type SendTextMessageInput = z.infer<typeof sendTextMessageInputSchema>;
export type StartTextingVerificationInput = z.infer<typeof startTextingVerificationInputSchema>;
export type TextContentKind = z.infer<typeof textContentKindSchema>;
export type TextConversationPage = z.infer<typeof textConversationPageSchema>;
export type TextConversationQuery = z.infer<typeof textConversationQuerySchema>;
export type TextMessage = z.infer<typeof textMessageSchema>;
export type TextMessageDirection = z.infer<typeof textMessageDirectionSchema>;
export type TextMessageStatus = z.infer<typeof textMessageStatusSchema>;
export type TextingConnection = z.infer<typeof textingConnectionSchema>;
export type TextingConnectionState = z.infer<typeof textingConnectionStateSchema>;
export type TextingCountry = z.infer<typeof textingCountrySchema>;
export type TextingVerificationChallenge = z.infer<typeof textingVerificationChallengeSchema>;
```

`normalizeTextingPhoneNumber` must parse with `libphonenumber-js/max`, require a valid number in the selected `US` or `CA` region, require country calling code `1`, and return only `{ country, e164, lastFour }`. Verification remains the final SMS-capability proof.

- [ ] **Step 4: Extend authorization and feature contracts**

Add `texting:read` and `texting:write` to `accessScopeSchema`; add a `superRefine` to `createAccessTokenInputSchema` that rejects write without read. Add `texting` to `featureIds`, `twilio` and `text_message` to `MaterialSourceReference`, and this feature policy:

```ts
texting: {
  readScope: "texting:read",
  mutationPolicy: "approved_rule",
  writeScope: "texting:write",
},
```

Add both scopes to the explicit `allScopes` sets in `auth-service.ts` and `oauth-service.ts`; make OAuth scope parsing reject `texting:write` without `texting:read` with `invalid_request`.

- [ ] **Step 5: Record the Texting ownership boundary**

Add a `Texting` row to `feature-ownership.md` owning `packages/domain/src/texting.ts`, `packages/connectors/src/twilio.ts`, `packages/database/src/texting-repository.ts`, `apps/api/src/texting-*`, `apps/api/src/routes/texting.ts`, `packages/api-client/src/features/texting.ts`, `apps/mcp/src/tools/texting.ts`, and `apps/web/src/features/texting`. Keep composition roots, schema, migration journal, and settings navigation Integration-owned.

- [ ] **Step 6: Run the focused authorization and domain tests**

Run: `pnpm vitest run packages/domain/src/texting.test.ts packages/domain/src/domain.test.ts apps/api/src/auth-service.test.ts apps/api/src/oauth-service.test.ts`

Expected: PASS, including write-without-read rejection for personal and OAuth tokens.

- [ ] **Step 7: Commit the contract boundary**

```bash
git add packages/domain apps/api/src/auth-service.ts apps/api/src/oauth-service.ts docs/engineering/feature-ownership.md pnpm-lock.yaml
git commit -m "feat: define texting contracts and scopes"
```

---

### Task 2: Atomic Texting Persistence Migration

**Files:**
- Modify: `packages/database/src/schema.ts`
- Create: `packages/database/migrations/0037_texting.sql`
- Create: `packages/database/migrations/meta/0037_snapshot.json`
- Modify: `packages/database/migrations/meta/_journal.json`
- Create: `packages/database/src/texting-schema.test.ts`

**Interfaces:**
- Consumes: Texting enum types from Task 1, existing `EncryptedCredentials`, `users`, `accessTokens`, and Drizzle timestamp/index conventions.
- Produces: `textingConnections`, `textingVerificationChallenges`, `textMessages`, `textingConsentEvents`, and `textingProviderEvents` with database-enforced ownership, uniqueness, ordering, and cascade behavior.

- [ ] **Step 1: Write a migration test that states the durable invariants**

```ts
it("enforces one active owner for a verified phone fingerprint", async () => {
  await db.insert(textingConnections).values(activeConnection(userA, "fingerprint"));
  await expect(
    db.insert(textingConnections).values(activeConnection(userB, "fingerprint")),
  ).rejects.toMatchObject({ code: "23505" });
});

it("cascades account deletion but preserves messages across disconnect", async () => {
  const connection = await seedTextingConversation(db, userA);
  await db.update(textingConnections).set({ state: "disconnected" }).where(eq(textingConnections.id, connection.id));
  expect(await db.select().from(textMessages)).toHaveLength(1);
  await db.delete(users).where(eq(users.id, userA));
  expect(await db.select().from(textMessages)).toHaveLength(0);
});
```

- [ ] **Step 2: Run the schema test and confirm the tables are absent**

Run: `pnpm vitest run packages/database/src/texting-schema.test.ts`

Expected: FAIL because the five table exports do not exist.

- [ ] **Step 3: Add the five Drizzle tables**

Use text columns typed with the Task 1 enums and include these exact persistence fields:

```ts
export const textingConnections = pgTable("texting_connections", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  encryptedPhoneNumber: jsonb("encrypted_phone_number").$type<EncryptedCredentials>(),
  phoneFingerprint: text("phone_fingerprint"),
  maskedPhoneNumber: text("masked_phone_number"),
  country: text("country").$type<TextingCountry>(),
  state: text("state").$type<TextingConnectionState>().notNull().default("disconnected"),
  consentEpoch: integer("consent_epoch").notNull().default(0),
  conversationRevision: integer("conversation_revision").notNull().default(0),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  consentedAt: timestamp("consented_at", { withTimezone: true }),
  providerStateAt: timestamp("provider_state_at", { withTimezone: true }),
  providerSyncError: text("provider_sync_error"),
  suspendedAt: timestamp("suspended_at", { withTimezone: true }),
  disconnectedAt: timestamp("disconnected_at", { withTimezone: true }),
  conversationDeletedBefore: timestamp("conversation_deleted_before", { withTimezone: true }),
  ...timestamps,
});
```

Give `userId` a unique index. Add a partial unique index on non-null `phoneFingerprint` where `state <> 'disconnected'`. Define the other tables with these columns:

- `texting_verification_challenges`: ID, user ID, encrypted candidate number, fingerprint, masked display, country, Twilio verification SID, status, consent copy version, consent accepted time, expires time, attempt count, superseded/challenge lifecycle timestamps.
- `text_messages`: ID, user ID, connection ID, consent epoch, direction, final body, encrypted phone snapshot, masked phone snapshot, provider Message SID, status, provider-safe error code, predicted/actual segments, occurred time/source, sent/delivered/provider-updated times, actor type, access-token ID, content kind, series ID/part/total, idempotency subject/key/body hash, request ID, timestamps.
- `texting_consent_events`: ID, user ID, connection ID, consent epoch, transition, source, provider event reference, actor type/ID, effective time, received time, request ID, redacted before/after JSON, created time.
- `texting_provider_events`: ID, nullable user/connection IDs, unique provider event ID, type, schema version, provider time, processing result, payload fingerprint, received time, expiry time.

Add stable `(user_id, occurred_at, id)` conversation indexes, unique non-null provider SID, unique `(idempotency_subject, idempotency_key)`, consent ordering indexes, and provider receipt expiry/indexes. Every user-owned foreign key cascades on user deletion; message connection references cascade only with account deletion because one durable connection row remains per user.

Add SQL `CHECK` constraints for every state/direction/status/source enum,
positive segment counts, series part/total consistency, nonnegative epochs and
revisions, and the requirement that active rows have encrypted phone,
fingerprint, mask, country, verification, and consent values. The TypeScript
`$type` annotations alone are not database enforcement.

- [ ] **Step 4: Generate and inspect one atomic migration**

Run: `pnpm --filter @personal-os/database db:generate -- --name texting`

Expected: `0037_texting.sql`, its snapshot, and one journal entry. Inspect SQL for five creates, foreign-key order, partial uniqueness, no table rewrite/backfill, and no destructive statement.

- [ ] **Step 5: Run the migration test against a fresh PostgreSQL instance**

Run: `pnpm vitest run packages/database/src/texting-schema.test.ts`

Expected: PASS for uniqueness, cascade, disconnect preservation, provider-ID deduplication, and idempotency conflicts.

- [ ] **Step 6: Commit schema and migration together**

```bash
git add packages/database/src/schema.ts packages/database/src/texting-schema.test.ts packages/database/migrations
git commit -m "feat: add texting persistence"
```

---

### Task 3: Transactional Texting Repository

**Files:**
- Create: `packages/database/src/texting-repository.ts`
- Create: `packages/database/src/texting-repository.test.ts`
- Modify: `packages/database/src/index.ts`
- Modify: `packages/database/package.json`

**Interfaces:**
- Consumes: Task 2 tables and a Drizzle `Database`.
- Produces: `TextingRepository` and `createTextingRepository(db)`; later service tasks must use this repository instead of importing Texting tables.

- [ ] **Step 1: Write failing repository transaction tests**

```ts
it("activates a verified replacement atomically", async () => {
  const result = await repository.activateApprovedChallenge({ challengeId, now, userId });
  expect(result.connection).toMatchObject({ consentEpoch: 2, state: "active" });
  expect(result.previousFingerprint).toBe("old-fingerprint");
});

it("locks a revision so concurrent outbound reservations cannot both win", async () => {
  const attempts = await Promise.allSettled([
    repository.reserveOutbound(reservation),
    repository.reserveOutbound(reservation),
  ]);
  expect(attempts.filter((item) => item.status === "fulfilled")).toHaveLength(1);
});
```

- [ ] **Step 2: Run the repository tests and confirm the factory is absent**

Run: `pnpm vitest run packages/database/src/texting-repository.test.ts`

Expected: FAIL because `createTextingRepository` is not exported.

- [ ] **Step 3: Define the repository contract**

```ts
export type TextingRepository = ReturnType<typeof createTextingRepository>;

type ConnectionRecord = typeof textingConnections.$inferSelect;
type ChallengeRecord = typeof textingVerificationChallenges.$inferSelect;
type MessageRecord = typeof textMessages.$inferSelect;

export function createTextingRepository(db: Database) {
  return {
    createVerificationChallenge,
    supersedePendingChallenges,
    getChallengeForUser,
    markChallengeFailed,
    activateApprovedChallenge,
    getConnectionForUser,
    getRoutableConnectionByFingerprint,
    disconnectConnection,
    deleteConversation,
    listMessages,
    appendInboundMessage,
    recordConsentEvent,
    applyOrderedConsentTransition,
    reserveOutbound,
    attachProviderSendResult,
    markOutboundUnknown,
    applyStatusCallback,
    findIdempotentOutbound,
    getOutboundQuotaUsage,
    recordAudit,
    recordProviderEventOnce,
    completeProviderEvent,
    pruneExpiredProviderEvents,
    listTextingTokenSummaries,
  };
}
```

Give the returned methods these service-facing signatures:

```ts
createVerificationChallenge(values: typeof textingVerificationChallenges.$inferInsert): Promise<ChallengeRecord>;
supersedePendingChallenges(userId: string, exceptId: string, at: Date): Promise<void>;
getChallengeForUser(userId: string, challengeId: string): Promise<ChallengeRecord | null>;
markChallengeFailed(userId: string, challengeId: string, status: "failed" | "expired", at: Date): Promise<void>;
activateApprovedChallenge(input: { challengeId: string; now: Date; userId: string }): Promise<{ connection: ConnectionRecord; previousFingerprint: string | null }>;
getConnectionForUser(userId: string): Promise<ConnectionRecord | null>;
getRoutableConnectionByFingerprint(fingerprint: string): Promise<ConnectionRecord | null>;
disconnectConnection(input: { mutationAudit: AuditInsert; now: Date; userId: string }): Promise<void>;
deleteConversation(input: { mutationAudit: AuditInsert; now: Date; userId: string }): Promise<void>;
listMessages(input: { after?: { id: string; occurredAt: Date }; before?: { id: string; occurredAt: Date }; limit: number; userId: string }): Promise<{ hasMore: boolean; items: MessageRecord[] }>;
appendInboundMessage(input: { connectionId: string; message: typeof textMessages.$inferInsert; providerEventId: string }): Promise<MessageRecord | null>;
recordConsentEvent(values: typeof textingConsentEvents.$inferInsert): Promise<void>;
applyOrderedConsentTransition(input: { connectionId: string; event: typeof textingConsentEvents.$inferInsert; nextState: "active" | "opted_out" }): Promise<ConnectionRecord>;
reserveOutbound(input: OutboundReservation): Promise<MessageRecord>;
attachProviderSendResult(messageId: string, result: ProviderSendUpdate): Promise<MessageRecord>;
markOutboundUnknown(messageId: string, at: Date): Promise<MessageRecord>;
applyStatusCallback(input: ProviderStatusUpdate): Promise<MessageRecord | null>;
findIdempotentOutbound(input: { idempotencyKey: string; idempotencySubject: string }): Promise<MessageRecord | null>;
getOutboundQuotaUsage(userId: string, now: Date): Promise<{ lastMinuteMessages: number; last24HourSegments: number }>;
recordAudit(values: AuditInsert): Promise<void>;
recordProviderEventOnce(values: typeof textingProviderEvents.$inferInsert): Promise<boolean>;
completeProviderEvent(providerEventId: string, result: string): Promise<void>;
pruneExpiredProviderEvents(now: Date): Promise<number>;
listTextingTokenSummaries(userId: string): Promise<Array<{ id: string; name: string; scopes: AccessScope[] }>>;
```

Define `OutboundReservation`, `ProviderSendUpdate`, `ProviderStatusUpdate`, and
`AuditInsert` in the repository module from the corresponding table insert
types, narrowing only the fields the service is allowed to provide. Do not
accept a raw transaction or arbitrary SQL callback from the API layer.

Use `db.transaction` and `SELECT ... FOR UPDATE` for activation, consent transitions, conversation deletion, inbound append, and outbound reservation. `reserveOutbound` must compare the expected connection ID, consent epoch, and conversation revision under the lock; insert the pending row, reserve predicted segments, append the redacted audit values passed by the service, and increment revision in the same transaction.

- [ ] **Step 4: Implement stable pagination and ordered callbacks**

`listMessages` must order by `(occurredAt, id)` ascending in its returned page, fetch one extra row to derive `hasEarlierMessages`, and apply `conversationDeletedBefore`. `applyStatusCallback` must accept only forward transitions in this graph:

```ts
const allowedStatusTransitions = {
  accepted: ["queued", "sending", "sent", "delivered", "undelivered", "failed", "unknown"],
  queued: ["sending", "sent", "delivered", "undelivered", "failed", "unknown"],
  sending: ["sent", "delivered", "undelivered", "failed", "unknown"],
  sent: ["delivered", "undelivered", "failed"],
  delivered: [],
  undelivered: [],
  failed: [],
  unknown: ["sent", "delivered", "undelivered", "failed"],
} as const;
```

Duplicate and older callbacks return the existing row without mutation.

- [ ] **Step 5: Verify fresh-database repository behavior**

Run: `pnpm vitest run packages/database/src/texting-repository.test.ts packages/database/src/texting-schema.test.ts`

Expected: PASS for locks, stable cursor tuples, deduplication, ordered consent, quota sums, history deletion cutoff, and late callback no-op behavior.

- [ ] **Step 6: Commit the repository**

```bash
git add packages/database/src/texting-repository.ts packages/database/src/texting-repository.test.ts packages/database/src/index.ts packages/database/package.json
git commit -m "feat: add transactional texting repository"
```

---

### Task 4: Twilio Connector, Encoding, and Provider Authentication

**Files:**
- Create: `packages/connectors/src/twilio.ts`
- Create: `packages/connectors/src/twilio.test.ts`
- Modify: `packages/connectors/src/index.ts`
- Modify: `packages/connectors/package.json`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Consumes: Task 1 Texting types and the official Twilio SDK.
- Produces: `TwilioTextingConnector`, `createTwilioTextingConnector`, `estimateTwilioSegments`, normalized inbound/status/Event Streams events, and provider-safe errors.

- [ ] **Step 1: Write failing encoding and normalization tests**

```ts
it.each([
  ["a".repeat(160), "GSM-7", 1],
  ["a".repeat(161), "GSM-7", 2],
  ["界".repeat(70), "UCS-2", 1],
  ["界".repeat(71), "UCS-2", 2],
])("estimates toll-free segments", (body, encoding, segments) => {
  expect(estimateTwilioSegments(body)).toMatchObject({ encoding, segments });
});

it("normalizes only authenticated inbound data for the configured sender", () => {
  expect(connector.parseInboundMessage(validInboundForm)).toMatchObject({
    from: "+12125550123",
    messageSid: "SM123",
    to: "+18885550123",
  });
  expect(() => connector.parseInboundMessage({ ...validInboundForm, To: "+18885559999" })).toThrow();
});
```

- [ ] **Step 2: Run connector tests and confirm the module is absent**

Run: `pnpm vitest run packages/connectors/src/twilio.test.ts`

Expected: FAIL because the Twilio connector and estimator do not exist.

- [ ] **Step 3: Add the official SDK and the provider-neutral connector surface**

Run: `pnpm --filter @personal-os/connectors add twilio`

Define this injectable boundary so tests never make network calls:

```ts
export type NormalizedInboundText = {
  accountSid: string;
  body: string;
  from: string;
  messageSid: string;
  optOutType: "STOP" | "START" | "HELP" | "NONE";
  receivedAt: Date;
  to: string;
};
export type NormalizedTextStatus = {
  accountSid: string;
  errorCode: string | null;
  from: string;
  messageSid: string;
  occurredAt: Date;
  segments: number | null;
  status: TextMessageStatus;
  to: string;
};
export type NormalizedTwilioEvent = {
  accountSid: string;
  eventId: string;
  from: string;
  messageSid: string;
  optOutType: "STOP" | "START" | "HELP" | "NONE";
  providerTime: Date;
  schemaVersion: string;
  to: string;
};
export type TwilioSendResult = {
  errorCode: string | null;
  messageSid: string;
  segments: number | null;
  status: TextMessageStatus;
};
export type TwilioTextingConnector = {
  startVerification(input: { channel: "sms"; to: string }): Promise<{ sid: string; status: string }>;
  checkVerification(input: { code: string; verificationSid: string }): Promise<{ status: string }>;
  sendMessage(input: { body: string; statusCallback: string; to: string }): Promise<TwilioSendResult>;
  validateFormWebhook(input: { parameters: Record<string, string>; signature: string; url: string }): boolean;
  validateEventWebhook(input: { rawBody: string; signature: string; url: string }): boolean;
  parseInboundMessage(parameters: Record<string, string>): NormalizedInboundText;
  parseStatusCallback(parameters: Record<string, string>): NormalizedTextStatus;
  parseEventStream(rawBody: string): NormalizedTwilioEvent[];
};
```

`createTwilioTextingConnector` must receive the configured account SID, restricted API key SID/secret, Auth Token, Verify Service SID, Messaging Service SID, toll-free E.164 number, exact public URLs, an injectable SDK client, and injectable signature validators. Production construction uses Twilio's supported SDK for Verify, Message creation, and request signature validation.

Start verification with `verifications.create({ channel: "sms", to })` and
check it with `verificationChecks.create({ code, verificationSid })`. The
Verification SID is the non-PII identifier already stored on the pending
challenge; the connector never needs to return the encrypted destination to
the caller during a check.

- [ ] **Step 4: Implement exact Smart Encoding and segment estimation**

Represent Twilio's documented Smart Encoding substitutions as a frozen map. Apply substitutions before detecting the GSM-7 basic/extension alphabets; count GSM extension characters as two septets. Use 160/70 for one segment and 152/66 for concatenated US/Canada toll-free messages:

```ts
export type SegmentEstimate = {
  encodedBody: string;
  encoding: "GSM-7" | "UCS-2";
  characters: number;
  segments: number;
};
```

Preserve intentional characters that Smart Encoding does not document. Do not transliterate non-English text or remove accessibility characters.

- [ ] **Step 5: Normalize provider errors and events without leaking payloads**

Map Twilio status values to the Task 1 state graph. Return only `code`, `status`, and a fixed safe message for errors; preserve `21610` explicitly. Parse the pinned `com.twilio.messaging.inbound-message.received` schema, accept additive fields, require CloudEvent ID/provider time/schema type, and normalize `optOutType` to `STOP`, `START`, `HELP`, or `NONE`. Reject a wrong account, sender, destination, schema, signature, or Event Streams Basic Auth before returning any normalized event.

- [ ] **Step 6: Run all connector tests**

Run: `pnpm vitest run packages/connectors/src/twilio.test.ts packages/connectors/src/types.test.ts`

Expected: PASS for GSM extension characters, Smart Encoding substitutions, UCS-2, 10-segment boundary values, signed form callbacks, signed Event Streams arrays, additive fields, wrong sender/account rejection, and error `21610`.

- [ ] **Step 7: Commit the connector**

```bash
git add packages/connectors/src/twilio.ts packages/connectors/src/twilio.test.ts packages/connectors/src/index.ts packages/connectors/package.json pnpm-lock.yaml
git commit -m "feat: add Twilio texting connector"
```

---

### Task 5: Verification, Connection, and Consent Lifecycle Service

**Files:**
- Create: `apps/api/src/texting-security.ts`
- Create: `apps/api/src/texting-security.test.ts`
- Create: `apps/api/src/texting-telemetry.ts`
- Create: `apps/api/src/texting-service.ts`
- Create: `apps/api/src/texting-service.integration.test.ts`
- Modify: `apps/api/src/serialization.ts`
- Modify: `apps/api/src/serialization.test.ts`

**Interfaces:**
- Consumes: `TextingRepository`, `TwilioTextingConnector`, `encryptJson`/`decryptJson`, Task 1 schemas, and `auditValues`.
- Produces: `createTextingService(options)` with feature availability, setup, verification, replacement, disconnect, deletion, redacted audit, and consent-state methods.

- [ ] **Step 1: Write failing security-helper and verification-lifecycle tests**

```ts
it("fingerprints by purpose-specific HMAC and never by plain hash", () => {
  expect(phoneFingerprint("+12125550123", fingerprintKey)).toHaveLength(64);
  expect(phoneFingerprint("+12125550123", fingerprintKey)).not.toBe(hashToken("+12125550123"));
});

it("keeps the existing number active until the replacement is approved", async () => {
  const challenge = await service.startVerification(userId, {
    consentAccepted: true,
    country: "CA",
    phoneNumber: "+14165550123",
  }, humanMutation);
  expect(await service.getConnection(userId)).toMatchObject({ maskedPhoneNumber: "•••0123" });
  await service.checkVerification(userId, challenge.id, { code: "123456" }, humanMutation);
  expect(await service.getConnection(userId)).toMatchObject({ country: "CA", state: "active" });
});
```

- [ ] **Step 2: Run the tests and confirm the service is absent**

Run: `pnpm vitest run apps/api/src/texting-security.test.ts apps/api/src/texting-service.integration.test.ts`

Expected: FAIL because the security helpers and service do not exist.

- [ ] **Step 3: Implement purpose-bound cryptographic envelopes**

Define:

```ts
export function phoneFingerprint(e164: string, key: string): string;
export type TextingTokenPurpose =
  | "conversation_cursor"
  | "conversation_receipt"
  | "length_review"
  | "exceptional_length";
export function signTextingToken<T extends object>(purpose: TextingTokenPurpose, value: T, key: string): string;
export function verifyTextingToken<T>(purpose: TextingTokenPurpose, token: string, key: string): T;
```

Use HMAC-SHA-256 and constant-time signature comparison. Token payloads carry `version: 1`, purpose, issued-at, and expires-at. Reject wrong purpose, malformed encoding, signature mismatch, and expiry with a fixed safe error. Keep phone encryption on the existing AES-256-GCM helper; never use the deterministic fingerprint as encryption.

- [ ] **Step 4: Implement the service dependency contract and availability gate**

Create `texting-telemetry.ts` with the narrow `TextingTelemetry` interface and
a no-op default; Task 8 will add the complete event vocabulary and assertions.

```ts
export type TextingTelemetry = {
  record(event: { accountRef?: string; name: string; outcome: string }): void;
};

type TextingServiceOptions = {
  encryptionKey: string;
  enabled: boolean;
  outboundEnabled: boolean;
  canaryUserIds: ReadonlySet<string>;
  fingerprintKey: string;
  now: () => Date;
  receiptSigningKey: string;
  repository: TextingRepository;
  senderPhoneNumber: string;
  telemetry: TextingTelemetry;
  twilio: TwilioTextingConnector;
};

type TextingMutationContext = {
  principal: { actorId: string; actorType: ActorType; userId: string };
  requestId: string;
};
```

`isSetupAvailable(userId)` returns true only when enabled and the canary set is empty or contains the user. `getAvailability` returns true for those users or for a user who already has a connection, so an existing user can still inspect state, disconnect, or delete history during a rollout pause. Starting/replacing verification requires setup availability; sending requires setup availability plus `outboundEnabled`. Reading an existing conversation and authenticated provider ingress do not depend on either rollout flag. This preserves history and STOP/START safety when product exposure or outbound sending is disabled.

- [ ] **Step 5: Implement human-only connection operations**

Expose these exact methods:

```ts
getAvailability(userId: string): Promise<{ available: boolean }>;
getConnection(userId: string): Promise<TextingConnection>;
startVerification(userId: string, input: StartTextingVerificationInput, mutation: TextingMutationContext): Promise<TextingVerificationChallenge>;
checkVerification(userId: string, challengeId: string, input: CheckTextingVerificationInput, mutation: TextingMutationContext): Promise<TextingConnection>;
disconnect(userId: string, mutation: TextingMutationContext): Promise<void>;
deleteConversation(userId: string, mutation: TextingMutationContext): Promise<void>;
setAdministrativeSuspension(userId: string, suspended: boolean, mutation: TextingMutationContext): Promise<TextingConnection>;
markProviderSyncError(userId: string, safeReason: string): Promise<void>;
recoverProviderSync(userId: string): Promise<void>;
```

Start verification only after `consentAccepted: true`; normalize, fingerprint, encrypt, supersede prior pending challenges, call Verify SMS, and store a 10-minute challenge with consent version `2026-08-28-v1` but without the code. Checking increments attempt metadata and accepts only Twilio `approved`. Activation then locks every retained connection with that fingerprint and carries forward the latest authenticated provider STOP/START state: website consent never overwrites an unresolved carrier STOP, so the replacement becomes `opted_out` and instructs the handset to send START when necessary. Otherwise activation atomically replaces the number with a new consent epoch. Disconnect preserves messages, encrypted routing history, fingerprint, and suppression history but removes the row from inbound routing. Account deletion still cascades that mirror; if the same number later joins another account, Twilio remains authoritative and error `21610` restores the local block on the first attempted send. Deletion removes message/provider material, advances revision, and records a cutoff plus redacted audit. Administrative suspension and provider sync failure block sends without erasing verification; recovery restores `active` only when consent is still valid.

Extend `auditSnapshot`'s denylist with `body`, `encryptedPhoneNumber`,
`encryptedPhoneSnapshot`, `necessity`, `phoneNumber`, and `verificationCode`.
Add a serialization test proving nested values under each key become
`[redacted]`; service audits should still construct the smallest explicit
before/after shape instead of relying only on this fallback.

- [ ] **Step 6: Verify abuse and lifecycle behavior**

Add fixed-window limiters for verification starts by user, fingerprint, and trusted client IP, plus checks by challenge/user. Assert expired/failed checks do not disturb an active number, uniqueness conflicts return a safe conflict, STOP survives disconnect/reassignment until a later handset START, and no test log/audit contains E.164, OTP, or body text.

Run: `pnpm vitest run apps/api/src/texting-security.test.ts apps/api/src/texting-service.integration.test.ts`

Expected: PASS for initial setup, replacement, expiry, failure, uniqueness, disconnect preservation, deletion, canary gating, and redaction.

- [ ] **Step 7: Commit the lifecycle service**

```bash
git add apps/api/src/texting-security.ts apps/api/src/texting-security.test.ts apps/api/src/texting-telemetry.ts apps/api/src/texting-service.ts apps/api/src/texting-service.integration.test.ts apps/api/src/serialization.ts apps/api/src/serialization.test.ts
git commit -m "feat: add texting connection lifecycle"
```

---

### Task 6: Authenticated Inbound Messages and Twilio Consent Synchronization

**Files:**
- Modify: `apps/api/src/texting-service.ts`
- Modify: `apps/api/src/texting-service.integration.test.ts`
- Create: `apps/api/src/texting-webhooks.ts`
- Create: `apps/api/src/texting-webhooks.test.ts`

**Interfaces:**
- Consumes: normalized Task 4 provider events and Task 5 service/repository.
- Produces: webhook handlers and service methods for inbound messages, Event Streams consent events, deduplication, ordering, and provider receipt pruning.

- [ ] **Step 1: Write failing inbound, STOP/START, and webhook-authentication tests**

```ts
it("stores a signed inbound message and advances the revision once", async () => {
  await service.receiveInbound(normalizedInbound);
  await service.receiveInbound(normalizedInbound);
  expect(await repository.listMessages({ userId, limit: 100 })).toHaveLength(1);
  expect((await repository.getConnectionForUser(userId))?.conversationRevision).toBe(1);
});

it("lets STOP win ties and only a later handset START reactivate", async () => {
  await service.receiveConsentEvent(stopAtNoon);
  await service.receiveConsentEvent(startAtNoon);
  expect(await service.getConnection(userId)).toMatchObject({ state: "opted_out" });
  await service.receiveConsentEvent(startAtOne);
  expect(await service.getConnection(userId)).toMatchObject({ state: "active" });
});
```

- [ ] **Step 2: Run the tests and confirm ingress methods are absent**

Run: `pnpm vitest run apps/api/src/texting-webhooks.test.ts apps/api/src/texting-service.integration.test.ts`

Expected: FAIL because provider ingress has not been implemented.

- [ ] **Step 3: Add inbound routing and deduplication**

`receiveInbound` must record the provider event once, fingerprint `From`, resolve exactly one verified non-disconnected connection, ignore unknown/disconnected senders after masked telemetry, exclude provider-classified compliance keywords, append ordinary inbound text with provider time when authenticated or receipt time otherwise, and atomically increment revision. Opted-out, sync-error, and suspended connections still retain inbound messages but cannot send. A duplicate Message SID or provider event is a successful no-op. The provider receipt fingerprint is an HMAC over provider event ID, Message SID, and event type; it never hashes or retains the message body or raw request.

- [ ] **Step 4: Add ordered consent synchronization**

`receiveConsentEvent` must process each validated CloudEvent independently, with STOP priority on equal/ambiguous provider times. STOP sets `opted_out`; HELP records an append-only event without changing state; START activates only the current verified handset and increments the consent epoch. A normal inbound after STOP may be stored but cannot alter consent. Prune provider receipts whose `expiresAt` is older than 30 days during authenticated ingress.

- [ ] **Step 5: Add framework-neutral webhook handlers**

```ts
export type TextingWebhookHandlers = {
  inbound(request: Request): Promise<Response>;
  events(request: Request): Promise<Response>;
};
```

The inbound handler reads the complete form body, validates `X-Twilio-Signature` against the configured exact public URL before normalization, and returns empty TwiML after durable commit. Event Streams requires exact sink Basic Auth plus its Twilio signature over the raw JSON before parsing the CloudEvents array. Invalid authentication returns 401/403 without logging or parsing sensitive values. Task 8 adds the status handler after outbound messages exist.

- [ ] **Step 6: Verify authenticated, duplicate, unknown, and out-of-order ingress**

Run: `pnpm vitest run apps/api/src/texting-webhooks.test.ts apps/api/src/texting-service.integration.test.ts`

Expected: PASS for signature failures, destination/account mismatch, duplicate events, unknown masked senders, STOP/START/HELP, equal timestamps, late events, and 30-day receipt pruning.

- [ ] **Step 7: Commit inbound and consent behavior**

```bash
git add apps/api/src/texting-service.ts apps/api/src/texting-service.integration.test.ts apps/api/src/texting-webhooks.ts apps/api/src/texting-webhooks.test.ts
git commit -m "feat: synchronize inbound texting consent"
```

---

### Task 7: Conversation Pagination, Local Time, and Fresh-Read Receipts

**Files:**
- Modify: `apps/api/src/texting-service.ts`
- Modify: `apps/api/src/texting-service.integration.test.ts`
- Create: `apps/api/src/texting-time.ts`
- Create: `apps/api/src/texting-time.test.ts`

**Interfaces:**
- Consumes: Task 3 stable message pagination and Task 5 signing helpers.
- Produces: `readConversation` and opaque signed cursor/receipt payloads used by HTTP, the typed client, and MCP.

- [ ] **Step 1: Write failing pagination, timestamp, and receipt-binding tests**

```ts
it("returns every canonical and localized timestamp with current local context", async () => {
  const page = await service.readConversation(agentPrincipal, { limit: 100 }, "America/New_York");
  expect(page).toMatchObject({
    asOf: "2026-08-28T19:00:00.000Z",
    currentLocalDateTime: expect.stringContaining("EDT"),
    timeZone: "America/New_York",
  });
  expect(page.messages[0]).toMatchObject({
    localDateTime: expect.stringContaining("August"),
    occurredAt: expect.stringMatching(/Z$/),
  });
  expect(page.conversationReceipt).toEqual(expect.any(String));
});

it("does not issue send receipts for cursor reads", async () => {
  const page = await service.readConversation(agentPrincipal, { beforeCursor }, "UTC");
  expect(page.conversationReceipt).toBeNull();
});
```

- [ ] **Step 2: Run the focused tests and confirm reading is absent**

Run: `pnpm vitest run apps/api/src/texting-time.test.ts apps/api/src/texting-service.integration.test.ts`

Expected: FAIL because timestamp formatting, cursors, and receipts are not implemented.

- [ ] **Step 3: Implement deterministic local date/time formatting**

```ts
export function formatTextingDateTime(instant: Date, timeZone: string): string {
  const display = new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "long",
    second: "2-digit",
    timeZone,
    timeZoneName: "short",
    weekday: "long",
    year: "numeric",
  }).format(instant);
  const offset = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "longOffset",
  })
    .formatToParts(instant)
    .find((part) => part.type === "timeZoneName")?.value.replace("GMT", "UTC");
  if (!offset) throw new AppError("internal_error", "The time-zone offset could not be formatted.");
  return `${display} (${offset})`;
}
```

Validate the requested MCP header time zone with `timeZoneSchema`; if it is absent, use the account planning time zone. Do not silently replace an invalid supplied zone.

- [ ] **Step 4: Implement signed cursors and conversation receipts**

Cursor payload: `{ occurredAt, id, direction: "before" | "after", userId }`. Receipt payload:

```ts
type ConversationReceiptPayload = {
  accessTokenId: string;
  connectionId: string;
  consentEpoch: number;
  conversationRevision: number;
  expiresAt: string;
  issuedAt: string;
  timeZone: string;
  userId: string;
  version: 1;
};
```

Only an agent access token reading the newest page without either cursor receives a five-minute receipt. Human-session reads may inspect history but receive `null` because web chat is not a product surface. Keep messages oldest-to-newest within each returned page and expose opaque earlier/newer cursors.

- [ ] **Step 5: Implement `readConversation`**

```ts
readConversation(
  principal: Principal,
  query: TextConversationQuery,
  requestedTimeZone: string | undefined,
): Promise<TextConversationPage>;
```

Return masked connection context, `asOf`, full `currentLocalDateTime`, canonical/localized message timestamps, lifecycle timestamps, `hasEarlierMessages`, and a receipt only for the qualifying newest read. Compliance events never enter results.

- [ ] **Step 6: Verify paging and receipt claims**

Run: `pnpm vitest run apps/api/src/texting-time.test.ts apps/api/src/texting-service.integration.test.ts`

Expected: PASS for equal-time ID ordering, before/after pages, 1/100 bounds, invalid zones, DST boundaries, midnight, explicit abbreviation plus UTC offset, epoch binding, token binding, and cursor reads without receipts.

- [ ] **Step 7: Commit reading and receipt behavior**

```bash
git add apps/api/src/texting-service.ts apps/api/src/texting-service.integration.test.ts apps/api/src/texting-time.ts apps/api/src/texting-time.test.ts
git commit -m "feat: add time-aware texting reads"
```

---

### Task 8: Safe Outbound Sending, Graduated Stops, Quotas, and Status Callbacks

**Files:**
- Modify: `apps/api/src/errors.ts`
- Modify: `apps/api/src/texting-service.ts`
- Modify: `apps/api/src/texting-service.integration.test.ts`
- Modify: `apps/api/src/texting-webhooks.ts`
- Modify: `apps/api/src/texting-webhooks.test.ts`
- Modify: `apps/api/src/texting-telemetry.ts`
- Create: `apps/api/src/texting-telemetry.test.ts`

**Interfaces:**
- Consumes: Task 4 estimator/send connector, Task 7 receipts, and Task 3 atomic reservation/idempotency/quota methods.
- Produces: `sendMessage`, structured stop errors, one-bubble/series enforcement, delivery-state updates, `21610` suppression, and redacted operational events.

- [ ] **Step 1: Write failing tests for every outbound safety boundary**

```ts
it("rejects a stale receipt before calling Twilio", async () => {
  await repository.appendInboundMessage(newInbound);
  await expect(service.sendMessage(agent, input, "America/New_York", mutation)).rejects.toMatchObject({
    code: "conversation_changed",
  });
  expect(twilio.sendMessage).not.toHaveBeenCalled();
});

it("requires both graduated confirmations for a nine-segment body", async () => {
  const first = await captureAppError(() => service.sendMessage(agent, longInput, zone, mutation));
  expect(first.code).toBe("long_message_review_required");
  const second = await captureAppError(() =>
    service.sendMessage(agent, { ...longInput, lengthReviewToken: first.details.token, necessity: "Requested full data", contentKind: "structured_data" }, zone, mutation),
  );
  expect(second.code).toBe("exceptional_length_confirmation_required");
});
```

- [ ] **Step 2: Run the integration tests and confirm outbound behavior is absent**

Run: `pnpm vitest run apps/api/src/texting-service.integration.test.ts apps/api/src/texting-webhooks.test.ts`

Expected: FAIL because sending, stop errors, quotas, and callbacks are incomplete.

- [ ] **Step 3: Add explicit API error codes and safe details**

Extend `ErrorCode` and status mapping with:

```ts
type TextingErrorCode =
  | "conversation_changed"                 // 409
  | "conversation_read_required"           // 409
  | "exceptional_length_confirmation_required" // 409
  | "long_message_review_required"         // 409
  | "quota_exceeded"                       // 429
  | "single_bubble_response_required"      // 409
  | "texting_blocked"                      // 409
  | "texting_disabled";                    // 503
```

Details may contain segment encoding/count, retry-after, a signed length token, and a compression target. They must never contain provider payloads, credentials, full phone numbers, or body text.

- [ ] **Step 4: Enforce receipt, state, envelope, and segment gates before persistence**

`sendMessage(principal, input, requestedTimeZone, mutation)` performs this order: idempotency replay lookup; receipt signature/expiry/token/user/zone verification; locked connection/revision/epoch check; active/provider-ready/outbound-enabled check; API-owned identity/opt-out envelope; series label; Smart Encoding estimate; graduated stop; one-bubble/series check; rolling quotas; atomic reservation/audit/revision increment; provider call; durable result update. A graduated stop may append its redacted audit event, but it does not persist a message, consume the receipt or idempotency key, advance revision, or reserve quota. Any body change recomputes the segment class and invalidates both length tokens. The exact ordinary envelope is `ilo: {body}`. The first message in each consent epoch is `ilo: {body}\nReply STOP to unsubscribe.` A series uses `ilo (part/total): {body}` and adds the opt-out line to part one when required.

For 4–6 segments, return a signed `lengthReviewToken` until the unchanged body has non-`concise` content kind and a 1–240 character necessity. For 7–10, require the first token, then a second signed `exceptionalLengthToken`, and permit only `structured_data`, `requested_large_content`, or `safety_critical`. More than 10 always fails. Both tokens bind access-token ID, receipt hash, final body hash, segment class, content kind, and five-minute expiry. Do not persist the necessity.

- [ ] **Step 5: Enforce one bubble and server-tracked series**

A second outbound whose preceding conversation message is outbound and less than five minutes old fails unless it is the exact next part of an open series. Opening requires `contentKind` of `structured_data` or `requested_large_content` and `seriesTotal` 2–3; the server creates the UUID and prepends `(1/N)`. Continuations require the issued series ID, next part, same token, same total, and a new conversation read. Any inbound after the prior part cancels continuation. More than three parts is impossible by schema and service checks.

- [ ] **Step 6: Reserve quotas, send once, and reconcile status**

Reserve predicted segments in the same transaction as the pending message and audit. Enforce 5 messages/rolling minute and 100 predicted-or-actual segments/rolling 24 hours. Call Twilio once with decrypted active destination, configured Messaging Service, and configured status callback. On a timeout/ambiguous create, mark `unknown` and never auto-resend. On a known result, attach Message SID/status, append an audit event with a Twilio `text_message` source reference, and reconcile actual segments when present. A signed status callback advances the graph; error `21610` first records STOP/`opted_out`, then records the failed delivery.

- [ ] **Step 7: Add redacted telemetry and audit assertions**

```ts
export type TextingTelemetryEvent = {
  name: "texting.verification" | "texting.webhook" | "texting.consent" | "texting.send" | "texting.length_gate" | "texting.series" | "texting.provider_health";
  accountRef?: string;
  outcome: string;
  segmentClass?: "1-2" | "3" | "4-6" | "7-10" | "over-10";
};
export type TextingTelemetry = {
  record(event: TextingTelemetryEvent): void;
};
export function createTextingTelemetry(
  write: (entry: TextingTelemetryEvent) => void,
): TextingTelemetry;
```

Reject unknown telemetry attributes at construction. Count gate stops/overrides, series start/part/cancellation, predicted-versus-actual segment class, quota/circuit failures, provider uncertainty, consent reconciliation, callback lag, and delivery outcomes using opaque account references only. Every blocked, quota-rejected, length-stopped, or provider-failed attempt also writes a redacted audit record through `repository.recordAudit`; the record contains category/outcome but no body, phone, provider payload, or necessity.

- [ ] **Step 8: Run all outbound tests**

Run: `pnpm vitest run apps/api/src/texting-service.integration.test.ts apps/api/src/texting-webhooks.test.ts apps/api/src/texting-telemetry.test.ts`

Expected: PASS for receipt races, concurrent one-receipt sends, idempotent replay/conflict, every segment gate, body/token binding, one-bubble enforcement, series cancellation, both quotas, provider timeout, callback ordering, and `21610`.

- [ ] **Step 9: Commit outbound behavior**

```bash
git add apps/api/src/errors.ts apps/api/src/texting-service.ts apps/api/src/texting-service.integration.test.ts apps/api/src/texting-webhooks.ts apps/api/src/texting-webhooks.test.ts apps/api/src/texting-telemetry.ts apps/api/src/texting-telemetry.test.ts
git commit -m "feat: enforce safe outbound texting"
```

---

### Task 9: Configuration, HTTP Routes, Typed Client, and Composition

**Files:**
- Create: `apps/api/src/routes/texting.ts`
- Create: `apps/api/src/routes/texting.test.ts`
- Modify: `apps/api/src/config.ts`
- Modify: `apps/api/src/config.test.ts`
- Modify: `apps/api/src/types.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/main.ts`
- Modify: `apps/api/src/app.integration.test.ts`
- Modify: `apps/api/src/openapi.ts`
- Create: `packages/api-client/src/features/texting.ts`
- Create: `packages/api-client/src/features/texting.test.ts`
- Modify: `packages/api-client/src/client.ts`
- Modify: `packages/api-client/src/client.test.ts`

**Interfaces:**
- Consumes: complete Texting service and webhooks from Tasks 5–8.
- Produces: authenticated human/scoped HTTP routes, unauthenticated-but-provider-authenticated webhook routes, full deployment configuration, and `TextingApiClient` for web/MCP.

- [ ] **Step 1: Write failing route and typed-client contract tests**

```ts
it("keeps phone administration human-only and sending scope-bound", async () => {
  expect((await request("/v1/texting/verifications", { auth: "agent", body: verificationInput })).status).toBe(403);
  expect((await request("/v1/texting/messages", {
    auth: "none",
    body: sendInput,
    headers: { authorization: `Bearer ${textingReadOnlyToken}` },
  })).status).toBe(403);
});

it("sends an idempotency key and effective time zone", async () => {
  await client.sendTextMessage(sendInput, "America/New_York");
  expect(fetch).toHaveBeenCalledWith(expect.stringContaining("/v1/texting/messages"), expect.objectContaining({
    headers: expect.any(Headers),
  }));
});
```

- [ ] **Step 2: Run route/client tests and confirm the public surface is absent**

Run: `pnpm vitest run apps/api/src/routes/texting.test.ts packages/api-client/src/features/texting.test.ts packages/api-client/src/client.test.ts`

Expected: FAIL because Texting routes and client methods are missing.

- [ ] **Step 3: Add exact configuration and production validation**

Add these variables with Texting disabled by default:

```text
TEXTING_ENABLED=false
TEXTING_OUTBOUND_ENABLED=false
TEXTING_CANARY_USER_IDS=
TEXTING_PHONE_FINGERPRINT_KEY=
TEXTING_RECEIPT_SIGNING_KEY=
TWILIO_ACCOUNT_SID=
TWILIO_API_KEY_SID=
TWILIO_API_KEY_SECRET=
TWILIO_AUTH_TOKEN=
TWILIO_VERIFY_SERVICE_SID=
TWILIO_MESSAGING_SERVICE_SID=
TWILIO_TOLL_FREE_NUMBER=
TWILIO_INBOUND_WEBHOOK_URL=
TWILIO_STATUS_WEBHOOK_URL=
TWILIO_EVENT_STREAMS_WEBHOOK_URL=
TWILIO_EVENT_STREAMS_USERNAME=
TWILIO_EVENT_STREAMS_PASSWORD=
```

When `TEXTING_ENABLED=true`, require every Twilio value, a valid `+1` sender, exact HTTPS public URLs in production, and independent fingerprint/receipt secrets of at least 32 characters. If any Twilio/provider value is present while Texting is disabled, require the complete provider set so webhook safety cannot run partially configured. `TEXTING_OUTBOUND_ENABLED=true` is invalid when Texting is disabled.

- [ ] **Step 4: Register the authenticated feature routes**

```ts
GET    /v1/texting/availability
GET    /v1/texting/connection
POST   /v1/texting/verifications
POST   /v1/texting/verifications/:id/check
DELETE /v1/texting/connection
DELETE /v1/texting/conversation
GET    /v1/texting/messages
POST   /v1/texting/messages
```

Availability and all administration routes require `authenticate` plus `requireHuman`. Reading requires `texting:read`; sending requires `requireFeatureAccess("texting")`, which enforces `approved_rule`. Pass `X-Personal-OS-Timezone`, principal, request ID, and trusted client IP into service calls. Accept `Idempotency-Key` only on send and bound it to user/access-token/operation.

- [ ] **Step 5: Register provider-authenticated webhook routes before ilo authentication**

```ts
POST /webhooks/twilio/inbound
POST /webhooks/twilio/status
POST /webhooks/twilio/events
```

Register these routes whenever the complete provider configuration exists, even if `TEXTING_ENABLED=false`, so a rollout pause does not lose inbound messages or STOP/START events. Delegate raw requests to `TextingWebhookHandlers`. Do not attach ilo session/access-token middleware. Keep request IDs and secure headers, but do not allow the general JSON body helper to consume bodies before provider validation.

- [ ] **Step 6: Add the typed Texting client**

```ts
export type TextingApiClient = {
  getTextingAvailability(): Promise<{ available: boolean }>;
  getTextingConnection(): Promise<TextingConnection>;
  startTextingVerification(input: StartTextingVerificationInput): Promise<TextingVerificationChallenge>;
  checkTextingVerification(id: string, input: CheckTextingVerificationInput): Promise<TextingConnection>;
  disconnectTexting(): Promise<void>;
  deleteTextConversation(): Promise<void>;
  readTextConversation(query: Partial<TextConversationQuery>, timeZone: string): Promise<TextConversationPage>;
  sendTextMessage(input: SendTextMessageInput, timeZone: string): Promise<TextMessage>;
};
```

Compose it into `createApiClient`. `sendTextMessage` creates one UUID idempotency key per logical call and retries once only when `fetch` fails before any HTTP response, reusing that key. It never retries an API response or a successful HTTP response reporting provider `unknown`. Preserve `ApiClientError.code/details` so MCP receives graduated stops unchanged.

- [ ] **Step 7: Wire composition and OpenAPI**

Add injectable `twilio?: TwilioTextingConnector` and `textingTelemetry?: TextingTelemetry` to `AppDependencies`; default provider construction only from validated config and use a no-op telemetry sink in isolated app tests. Construct repository, connector, service, and handlers in `createApp`, then register feature routes. In `main.ts`, inject `createTextingTelemetry((entry) => process.stdout.write(JSON.stringify(entry) + "\n"))` so production emits the closed, redacted event vocabulary. Document every route, auth mode, scope, idempotency header, time-zone header, and webhook authentication in `openapi.ts`.

- [ ] **Step 8: Run route, config, client, and API integration tests**

Run: `pnpm vitest run apps/api/src/config.test.ts apps/api/src/routes/texting.test.ts apps/api/src/app.integration.test.ts packages/api-client/src/features/texting.test.ts packages/api-client/src/client.test.ts`

Expected: PASS for disabled defaults, incomplete production config rejection, human/agent isolation, scope pairs, arbitrary-number absence, webhook auth independence, time-zone forwarding, structured stops, and idempotent network retry.

- [ ] **Step 9: Commit the public API boundary**

```bash
git add apps/api/src/routes/texting.ts apps/api/src/routes/texting.test.ts apps/api/src/config.ts apps/api/src/config.test.ts apps/api/src/types.ts apps/api/src/app.ts apps/api/src/main.ts apps/api/src/app.integration.test.ts apps/api/src/openapi.ts packages/api-client/src/features/texting.ts packages/api-client/src/features/texting.test.ts packages/api-client/src/client.ts packages/api-client/src/client.test.ts
git commit -m "feat: expose texting API"
```

---

### Task 10: Stateless MCP Conversation and Send Tools

**Files:**
- Create: `apps/mcp/src/tools/texting.ts`
- Create: `apps/mcp/src/tools/texting.test.ts`
- Modify: `apps/mcp/src/server.ts`
- Modify: `apps/mcp/src/server.test.ts`
- Modify: `apps/mcp/src/http.ts`
- Modify: `apps/mcp/src/stdio.ts`
- Modify: `apps/mcp/src/tools/README.md`

**Interfaces:**
- Consumes: `TextingApiClient` from Task 9 and the already-derived MCP `timeZone`.
- Produces: `read_text_conversation` and `send_text_message` with accurate MCP annotations, descriptions, schemas, and structured API errors.

- [ ] **Step 1: Write failing MCP contract tests**

```ts
it("requires an explicit read before send and exposes full time context", async () => {
  const read = await client.callTool({ name: "read_text_conversation", arguments: {} });
  expect(read.structuredContent).toMatchObject({
    asOf: now,
    currentLocalDateTime: expect.any(String),
    conversationReceipt: "receipt",
  });
  await client.callTool({
    name: "send_text_message",
    arguments: { body: "Done - the reservation is confirmed for 7:00 PM EDT.", conversationReceipt: "receipt" },
  });
  expect(api.sendTextMessage).toHaveBeenCalledWith(expect.any(Object), "America/New_York");
});
```

- [ ] **Step 2: Run MCP tests and confirm the tools are absent**

Run: `pnpm vitest run apps/mcp/src/tools/texting.test.ts apps/mcp/src/server.test.ts`

Expected: FAIL because the two tools are not registered.

- [ ] **Step 3: Register the read tool with the full behavior contract**

`read_text_conversation` is `readOnlyHint: true`, `openWorldHint: false`, accepts `afterCursor`, `beforeCursor`, and `limit`, and forwards the server time zone. Its description must tell the agent to inspect every returned timestamp, participant, and relevant earlier page when `hasEarlierMessages` is true; only the uncursored newest page grants a send receipt.

- [ ] **Step 4: Register the mutation tool and agent-writing standard**

`send_text_message` accepts only the Task 1 fields and no destination/provider field. Annotate `openWorldHint: true`, with no `readOnlyHint` or `idempotentHint`. The description must include:

```text
Read the newest conversation immediately before every send. Ordinary replies are one bubble with no more than three short paragraphs: lead with the answer/action, omit greetings, filler acknowledgements, narration, repeated context, and sign-offs, use exact dates/numbers/actions, contain at most one question/action, and avoid Markdown tables/headings/emphasis/code fences or decorative punctuation. Prefer one segment, target one or two, treat three as the normal ceiling. Use short numbered lists only when sequence matters and normally no more than five items. Use a two- or three-part numbered series only for structured data or user-requested large content. Use full trusted or ilo-branded URLs, never shared public shorteners. Preserve intentional language/accessibility characters; use emoji only when meaningful and consistent with the user. Never send secrets, OTPs, access tokens, full financial account numbers, or unnecessary sensitive identifiers.
```

- [ ] **Step 5: Preserve graduated API errors as actionable tool results**

Update the tool-result adapter only if needed so `ApiClientError` returns `code`, safe `details`, and request ID in structured content while setting `isError: true`. Do not turn `long_message_review_required` or `exceptional_length_confirmation_required` into generic failures; the agent needs the issued token and compression target to decide whether to revise or resubmit.

- [ ] **Step 6: Forward the effective time zone in both transports**

The tool module passes `options.timeZone` to both client calls. HTTP continues to derive it from `X-Personal-OS-Timezone` with environment fallback; stdio uses `PERSONAL_OS_TIMEZONE` with system fallback. Do not put the time zone in tool arguments.

- [ ] **Step 7: Run MCP tool and transport tests**

Run: `pnpm vitest run apps/mcp/src/tools/texting.test.ts apps/mcp/src/server.test.ts apps/mcp/src/security.test.ts`

Expected: PASS for schemas, annotations, no recipient, timestamp fields, latest-read receipt flow, stale-read errors, every length stop, time-zone forwarding, and stateless API-only behavior.

- [ ] **Step 8: Commit the MCP tools**

```bash
git add apps/mcp/src/tools/texting.ts apps/mcp/src/tools/texting.test.ts apps/mcp/src/server.ts apps/mcp/src/server.test.ts apps/mcp/src/http.ts apps/mcp/src/stdio.ts apps/mcp/src/tools/README.md
git commit -m "feat: add safe texting MCP tools"
```

---

### Task 11: Human Texting Settings Experience

**Files:**
- Create: `apps/web/src/features/texting/page.tsx`
- Create: `apps/web/src/features/texting/page.test.tsx`
- Create: `apps/web/src/features/texting/manifest.ts`
- Create: `apps/web/src/components/ui/input-otp.tsx`
- Create: `apps/web/src/components/ui/spinner.tsx`
- Create: `apps/web/src/components/ui/alert-dialog.tsx`
- Modify: `apps/web/package.json`
- Modify: `apps/web/src/app.tsx`
- Modify: `apps/web/src/app.test.tsx`
- Modify: `apps/web/src/styles.css`
- Create: `docs/design/pages/texting-settings.md`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Consumes: Task 9 client methods, `TextingConnection`, access-token summaries, existing Settings card/alert/dialog/collapsible patterns, Sonner, and official shadcn Input OTP.
- Produces: a Texting Settings page with setup, verification, active, opted-out, sync-error, suspended, replacement, disconnect, deletion, and agent-access states; no web conversation view.

- [ ] **Step 1: Inspect and add the official OTP primitive**

Run:

```bash
cd apps/web
pnpm dlx shadcn@latest info --json
pnpm dlx shadcn@latest docs input-otp spinner alert alert-dialog field card collapsible sonner
pnpm dlx shadcn@latest add @shadcn/input-otp @shadcn/spinner @shadcn/alert-dialog --dry-run
pnpm dlx shadcn@latest add @shadcn/input-otp @shadcn/spinner @shadcn/alert-dialog
```

Review the added source for Base UI compatibility, project aliases, icon library, semantic tokens, and required `Field` composition before continuing.

- [ ] **Step 2: Write failing Testing Library coverage for all honest states**

```tsx
it("verifies a consenting user and then shows the shared ilo sender", async () => {
  renderTextingPage({ connection: disconnectedConnection });
  await user.type(screen.getByLabelText("Mobile number"), "2125550123");
  await user.click(screen.getByRole("checkbox", { name: /I agree to receive conversational texts/i }));
  await user.click(screen.getByRole("button", { name: "Send verification code" }));
  await user.type(screen.getByLabelText("Verification code"), "123456");
  await user.click(screen.getByRole("button", { name: "Verify number" }));
  expect(await screen.findByText("+1 888-555-0123")).toBeInTheDocument();
});

it("offers only handset START after Twilio opt-out", () => {
  renderTextingPage({ connection: optedOutConnection });
  expect(screen.getByText(/Text START to \+1 888-555-0123/)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /enable/i })).not.toBeInTheDocument();
});
```

- [ ] **Step 3: Run the feature test and confirm the page is absent**

Run: `pnpm vitest run apps/web/src/features/texting/page.test.tsx`

Expected: FAIL because the Texting feature page does not exist.

- [ ] **Step 4: Document the page grammar before implementation**

In `texting-settings.md`, state the immediate job: “Connect or manage the one phone number that can text this account's agents.” Classify setup/active connection as the single `moment`, verified number/provider/agent-scope rows as `summary`, opt-out/sync/suspension as `attention`, replacement/disconnect as `detail`, and conversation deletion as a destructive detail action. Explicitly state that Settings never displays conversation messages.

- [ ] **Step 5: Implement setup and verification states**

Use `Card` anatomy supplied by the existing Settings wrapper, `FieldGroup`/`Field`, country selection (`US`/`CA`), phone `Input`, consent `Checkbox`, official `InputOTP`, and pending buttons with `Spinner`. The consent copy identifies ilo, purpose/frequency, possible message/data rates, and STOP/HELP. Form errors use an adjacent destructive `Alert`; successful start/approval uses Sonner. Keep the already-active number visible while a replacement challenge is pending.

- [ ] **Step 6: Implement active and blocked states**

Active state shows the permanent ilo sender, masked personal number, active/provider state badge, verification time, and active token names carrying Texting scopes. `opted_out` renders an informational/warning `Alert` whose only recovery instruction is texting START from the handset. `sync_error` explains reads remain available and sends are blocked. `suspended` exposes no bypass. Loading uses `Skeleton`; API failure uses a retryable `Alert`.

- [ ] **Step 7: Implement rare and destructive controls**

Place change-number and disconnect controls in a labelled `Collapsible`. Use `AlertDialog` with title/description for disconnect and a separate deliberate confirmation for permanent conversation deletion. Disconnect copy says history is preserved; deletion copy says message content/provider metadata cannot be recovered except from backups. Use Sonner for transient success/failure and invalidate `texting-connection`, `tokens`, and availability query keys after mutation.

- [ ] **Step 8: Wire availability and token scope UX through Integration-owned roots**

Add Texting under the Settings “Automation” group before Agent access only when `getTextingAvailability().available` is true. A direct `?section=texting` URL redirects to Profile when unavailable. Add `texting:read`/`texting:write` labels to Agent access; selecting write automatically selects read, removing read removes write, and the Full ilo preset includes both.

- [ ] **Step 9: Add focused shell tests and responsive acceptance**

Test hidden navigation when disabled, deep-link redirect, all six connection states, OTP keyboard operation, write/read scope pairing, pending mutations, destructive dialogs, and no conversation rendering. Check 320 px and desktop layouts without horizontal overflow.

Run: `pnpm vitest run apps/web/src/features/texting/page.test.tsx apps/web/src/app.test.tsx`

Expected: PASS with accessible names, focusable controls, semantic persistent alerts, and transient toasts.

- [ ] **Step 10: Commit the Settings experience**

```bash
git add apps/web/src/features/texting apps/web/src/components/ui/input-otp.tsx apps/web/src/components/ui/spinner.tsx apps/web/src/components/ui/alert-dialog.tsx apps/web/src/app.tsx apps/web/src/app.test.tsx apps/web/src/styles.css apps/web/package.json docs/design/pages/texting-settings.md pnpm-lock.yaml
git commit -m "feat: add texting settings experience"
```

---

### Task 12: Deterministic Acceptance, Operations, and Final Verification

**Files:**
- Create: `e2e/fake-twilio.ts`
- Create: `e2e/api.ts`
- Modify: `e2e/serve.ts`
- Modify: `e2e/product.spec.ts`
- Modify: `.env.example`
- Modify: `docs/deployment.md`
- Modify: `docs/mcp.md`
- Create: `docs/product/texting-operations.md`
- Modify: `README.md`
- Modify: `infra/compute.tf`
- Modify: `infra/locals.tf`
- Modify: `infra/variables.tf`
- Modify: `infra/terraform.tfvars.example`
- Modify: `infra/README.md`

**Interfaces:**
- Consumes: the complete feature from Tasks 1–11.
- Produces: deterministic browser acceptance, deployment/provisioning/runbook documentation, MCP documentation, and final repository verification.

- [ ] **Step 1: Add a deterministic fake Twilio adapter for browser acceptance**

```ts
export function createFakeTwilioTextingConnector(): TwilioTextingConnector {
  return {
    startVerification: async () => ({ sid: "VE_e2e", status: "pending" }),
    checkVerification: async ({ code }) => ({ status: code === "123456" ? "approved" : "pending" }),
    sendMessage: async () => ({ messageSid: `SM_${crypto.randomUUID()}`, status: "queued", segments: 1 }),
    validateFormWebhook: () => true,
    validateEventWebhook: () => true,
    parseInboundMessage: () => {
      throw new Error("Browser acceptance does not parse provider webhooks.");
    },
    parseStatusCallback: () => {
      throw new Error("Browser acceptance does not parse provider webhooks.");
    },
    parseEventStream: () => {
      throw new Error("Browser acceptance does not parse provider webhooks.");
    },
  };
}
```

`e2e/api.ts` mirrors the normal API bootstrap but injects this adapter and enables Texting only in the E2E process. Change `e2e/serve.ts` to start that entry point. Production `main.ts` must never import the fake.

- [ ] **Step 2: Extend desktop/mobile Playwright acceptance**

Add one flow that opens Settings → Texting, accepts consent, verifies `+1 212-555-0123` with `123456`, sees the shared ilo number and active state, and creates an agent token with both Texting scopes. Use Playwright's API request context with the displayed one-time agent token to read the newest empty conversation in `America/New_York`, send one concise proactive message with its receipt, poll the conversation, and assert the returned outbound message has canonical and localized timestamps. Return to Settings, verify a replacement number before it becomes active, exercise disconnect, and confirm conversation deletion requires its separate destructive dialog. Assert no horizontal overflow in desktop and mobile projects.

- [ ] **Step 3: Document environment and MCP behavior**

Add every Task 9 variable to `.env.example` with Texting and outbound disabled. In `docs/mcp.md`, add both scopes and tools, mandatory fresh read, timestamp guarantees, one-bubble standard, segment gates, structured-series exception, and Twilio STOP/START behavior. Update the root README feature/setup list without suggesting the Twilio Conversations product.

- [ ] **Step 4: Write the provider provisioning and incident runbook**

`docs/product/texting-operations.md` must include:

1. Customer Profile and toll-free verification for the conversational-agent use case.
2. One toll-free number in the Messaging Service sender pool with Smart Encoding enabled and standard toll-free STOP filtering retained; do not enable Advanced Opt-Out.
3. Exact signed inbound/status URLs and Event Streams sink Basic Auth/signature settings.
4. Pinned inbound-message schema and `optOutType` subscription.
5. Verify Service fraud protection, public consent/privacy/support/opt-out copy, and secret-manager entries.
6. Canary enable/disable and the outbound circuit breaker.
7. Dashboards/alerts for signatures, sink lag, STOP/START reconciliation, `21610`, segment distribution, gates, series, quotas, failures, and unknown sends.
8. A real-handset US/Canada acceptance checklist covering verify, inbound, read timestamps, send, delivery, STOP, blocked local send, `21610`, START, resumed send, and redacted telemetry.
9. Incident actions that fail outbound closed while preserving inbound safety processing and reads.
10. The version-1 rule that Settings has no re-enable control and no Consent Management API path; only an authenticated handset START can reactivate after STOP.

- [ ] **Step 5: Wire production infrastructure without committing secrets**

Add Terraform variables `texting_enabled` and `texting_outbound_enabled`
(both default `false`), `texting_canary_user_ids` (default empty), and
`twilio_toll_free_number` (default empty). When enabled, the API task receives
those values plus exact webhook URLs derived from the deployed API origin and
the three fixed webhook paths. Add these names to the runtime secret-parameter
set and API task secret mapping:

```text
TEXTING_PHONE_FINGERPRINT_KEY
TEXTING_RECEIPT_SIGNING_KEY
TWILIO_ACCOUNT_SID
TWILIO_API_KEY_SID
TWILIO_API_KEY_SECRET
TWILIO_AUTH_TOKEN
TWILIO_VERIFY_SERVICE_SID
TWILIO_MESSAGING_SERVICE_SID
TWILIO_EVENT_STREAMS_USERNAME
TWILIO_EVENT_STREAMS_PASSWORD
```

Document secret creation in `infra/README.md`, add disabled examples to
`terraform.tfvars.example`, and run `terraform -chdir=infra fmt -check`. The
MCP and web tasks receive no Twilio credential.

- [ ] **Step 6: Run the complete focused Texting suite**

Run:

```bash
pnpm vitest run packages/domain/src/texting.test.ts packages/connectors/src/twilio.test.ts packages/database/src/texting-schema.test.ts packages/database/src/texting-repository.test.ts apps/api/src/texting-security.test.ts apps/api/src/texting-time.test.ts apps/api/src/texting-telemetry.test.ts apps/api/src/texting-webhooks.test.ts apps/api/src/texting-service.integration.test.ts apps/api/src/routes/texting.test.ts packages/api-client/src/features/texting.test.ts apps/mcp/src/tools/texting.test.ts apps/web/src/features/texting/page.test.tsx
```

Expected: PASS with no real Twilio network calls.

- [ ] **Step 7: Run deterministic acceptance and repository verification**

Run:

```bash
pnpm test:e2e
pnpm verify
```

Expected: desktop and mobile Texting acceptance passes; migration, lint, type checking, coverage thresholds, builds, and all repository tests pass.

- [ ] **Step 8: Review secret/body redaction and the final diff**

Run:

```bash
rg -n "console\.|process\.(stdout|stderr)|logger|telemetry|auditValues" apps/api/src/texting* packages/connectors/src/twilio.ts
git diff --check
git status --short
```

Inspect every match and verify it emits no phone, OTP, message body, raw webhook, necessity text, token, or Twilio credential. Confirm only intended Texting files, integration roots, migration artifacts, docs, and lockfile changed.

- [ ] **Step 9: Commit acceptance and operations**

```bash
git add e2e .env.example docs/deployment.md docs/mcp.md docs/product/texting-operations.md README.md infra
git commit -m "test: verify agent texting end to end"
```
