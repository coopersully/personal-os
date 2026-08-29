# Mail Unified Inbox and Compose Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Mail a unified-inbox-first, resizable mail client and restore safe text-message composing, drafts, replies, forwarding, and provider delivery with explicit confirmation and durable reconciliation.

**Architecture:** Mail keeps its current three-pane projection and moves provider accounts behind a secondary collapsed disclosure. Every outbound message is an Ilo-owned durable draft; the API claims the exact saved revision before one bounded provider attempt and converts any ambiguous result into human reconciliation instead of retrying. Google delivery uses Gmail HTTPS and explicit send authority, while iCloud delivery uses bounded authenticated SMTP submission with the matching production egress contract.

**Tech Stack:** TypeScript 5.8, React 19, TanStack Query 5, Motion 12, Hono 4, Drizzle ORM 0.45, PostgreSQL 17, Zod 4, Gmail API, Nodemailer, Vitest 3, Testing Library, Playwright, pnpm 11

**Spec:** `docs/superpowers/specs/2026-08-28-mail-unified-inbox-compose-design.md`

## Global Constraints

- Inbox is the default combined view; account-specific navigation remains available but collapsed and secondary.
- Compose is a bottom-inline-end Calendar-style floating surface with one closed plus trigger.
- Every send uses an owned durable draft and one explicit human confirmation.
- There is no draftless provider send and no automatic retry after possible provider acceptance.
- This slice is plain text with To and optional Cc; it exposes no Bcc or attachment affordance.
- Recipient addresses, subject, and body never enter logs, audit metadata, analytics, or provider-error text.
- Google read/manage and send authority are projected separately; existing read-capable accounts may require reconnect-to-send.
- iCloud SMTP submission uses TCP 587 with STARTTLS and bounded timeouts below the 60-second edge budget.
- MCP and autonomous/agent sending remain unavailable.
- Imported message content is untrusted data and never grants sending authority.
- Update the prior no-send documents explicitly; do not erase the historical decision.
- Use icons only through `@/components/icons`.

---

## Locked File Structure

### Mail-owned contracts and server behavior

- `packages/domain/src/mail.ts` owns `MailDraft`, draft inputs, send confirmation, and setup send capability.
- `packages/domain/src/mail.test.ts` owns schema/state contract tests.
- `apps/api/src/mail-service.ts` owns draft CRUD, exact-revision claims, send settlement, reconciliation, and setup capability projection.
- `apps/api/src/mail-service.integration.test.ts` owns persistence, ownership, replay, audit-redaction, and partial-effect tests.
- `apps/api/src/routes/mail.ts` owns authenticated human HTTP routes.
- `apps/api/src/routes/mail.test.ts` owns route parsing, scope, and human-confirmation tests.
- `packages/api-client/src/features/mail.ts` owns the typed browser API.
- `packages/api-client/src/client.test.ts` owns request/response contract tests.

### Provider and integration behavior

- `packages/connectors/src/types.ts` owns `SendRemoteMailInput` and connector send methods.
- `packages/connectors/src/google.ts` and `google.test.ts` own Gmail authority, MIME, submission, and ambiguity classification.
- `packages/connectors/src/icloud.ts` and `icloud.test.ts` own SMTP submission and bounded transport behavior.
- `apps/api/src/connector-service.ts` and `connector-service.integration.test.ts` own account authority, credential persistence, and safe provider errors.
- `packages/connectors/package.json` and `pnpm-lock.yaml` restore Nodemailer runtime/types.
- `scripts/check-provider-network-contract.mjs`, `infra/network.tf`, `infra/README.md`, and `docs/deployment.md` own TCP 587 runtime consistency.

### Web experience

- `apps/web/src/features/mail/mail.tsx` owns page queries, unified navigation, list/reader composition, and reader actions.
- `apps/web/src/features/mail/floating-compose.tsx` owns editor state, autosave, confirmation, recovery, focus, and motion.
- `apps/web/src/features/mail/floating-compose.test.tsx` owns composer interaction coverage.
- `apps/web/src/features/mail/mail.test.ts` and `mail-helpers.test.tsx` own routing/hierarchy/helper coverage.
- `apps/web/src/styles.css` owns Mail layout and bottom-end floating-surface styling.
- `apps/web/src/app.tsx` and `app.test.tsx` remove redundant page heading/action assumptions and preserve app-frame integration.
- `apps/api/src/qa-fixtures.ts` owns healthy, reconnect, read-only-send, draft, and uncertain-send browser fixtures.

### Durable guidance

- `docs/design/pages/mail.md`, `docs/design/system.md`, `docs/product/master-design.md`, `docs/product/assumptions-audit.md`, `docs/engineering/connector-reliability.md`, and `docs/product/implementation-log.md` describe the shipped contract.
- `docs/superpowers/specs/2026-08-15-mail-workspace-stewardship-design.md` and `docs/superpowers/plans/2026-08-25-mail-no-send-capability-removal.md` receive a prominent superseded notice without rewriting history.

---

### Task 1: Restore Mail Draft and Send Contracts

**Files:**
- Modify: `packages/domain/src/mail.ts`
- Modify: `packages/domain/src/mail.test.ts`
- Modify: `packages/api-client/src/features/mail.ts`
- Modify: `packages/api-client/src/client.test.ts`

**Interfaces:**
- Produces: `MailDraft`, `CreateMailDraftInput`, `UpdateMailDraftInput`, `SendMailDraftInput`, `ReconcileMailDraftInput`.
- Produces: `MailSetupAccount.sendCapability: "available" | "reconnect" | "unavailable"`.
- Produces: browser methods `createMailDraft`, `updateMailDraft`, `deleteMailDraft`, `listMailDrafts`, `sendMailDraft`, and `reconcileMailDraft`.

- [ ] **Step 1: Write failing domain tests for editable drafts and exact confirmation**

Add tests that parse an incomplete autosave draft, reject more than 100 recipients, expose no Bcc or attachment property, and require a saved revision for send:

```ts
const input = createMailDraftInputSchema.parse({
  accountId,
  body: "",
  cc: [],
  subject: "",
  to: [],
});
expect(input).toEqual({ accountId, body: "", cc: [], subject: "", to: [] });
expect(sendMailDraftInputSchema.parse({
  confirmedUpdatedAt: "2026-08-28T12:00:00.000Z",
  draftId,
})).toEqual({ confirmedUpdatedAt: "2026-08-28T12:00:00.000Z", draftId });
expect(mailSetupAccountSchema.parse(setupAccount).sendCapability).toBe("reconnect");
```

- [ ] **Step 2: Run the focused domain test and observe missing contracts**

Run: `pnpm exec vitest run packages/domain/src/mail.test.ts`

Expected: FAIL because the new schemas and setup capability do not exist.

- [ ] **Step 3: Add the exact domain schemas**

Implement these public shapes in `packages/domain/src/mail.ts`:

```ts
const mailDraftFields = {
  accountId: idSchema,
  body: z.string().max(100_000),
  cc: z.array(mailRecipientInputSchema).max(100).default([]),
  subject: mailHeaderTextSchema(998, true),
  threadId: idSchema.nullable().optional(),
  to: z.array(mailRecipientInputSchema).max(100).default([]),
};

export const createMailDraftInputSchema = z.object(mailDraftFields);
export const updateMailDraftInputSchema = z.object(mailDraftFields).extend({
  expectedUpdatedAt: isoDateTimeSchema,
});
export const sendMailDraftInputSchema = z.object({
  confirmedUpdatedAt: isoDateTimeSchema,
  draftId: idSchema,
});
export const reconcileMailDraftInputSchema = z.object({
  outcome: z.enum(["not_sent", "sent"]),
});
export const mailDraftSchema = z.object(mailDraftFields).extend({
  createdAt: isoDateTimeSchema,
  id: idSchema,
  reconciliationState: z.enum(["in_progress", "none", "sent_mail_review_required"]),
  sendClaimedAt: isoDateTimeSchema.nullable(),
  sendStatus: z.enum(["draft", "sending", "reconcile", "sent"]),
  sentAt: isoDateTimeSchema.nullable(),
  threadId: idSchema.nullable(),
  updatedAt: isoDateTimeSchema,
});
```

Add `sendCapability: z.enum(["available", "reconnect", "unavailable"])` to `mailSetupAccountSchema`. Keep `LegacyMailDraft` temporarily exported only for compatibility tests until Task 3 migrates the web feature.

- [ ] **Step 4: Add failing API-client request tests**

Assert the exact methods and routes:

```ts
await api.createMailDraft(input); // POST /v1/mail/drafts
await api.updateMailDraft(draftId, { ...input, expectedUpdatedAt }); // PATCH /v1/mail/drafts/:id
await api.listMailDrafts(); // GET /v1/mail/drafts
await api.sendMailDraft({ confirmedUpdatedAt, draftId }); // POST /v1/mail/send
await api.reconcileMailDraft(draftId, { outcome: "sent" }); // POST /v1/mail/drafts/:id/reconcile
await api.deleteMailDraft(draftId); // DELETE /v1/mail/drafts/:id
```

- [ ] **Step 5: Implement typed client methods and pass focused tests**

Return `{ draft }` payloads as `MailDraft`, `{ drafts }` as `MailDraft[]`, and serialize JSON with the exact methods above.

Run: `pnpm exec vitest run packages/domain/src/mail.test.ts packages/api-client/src/client.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit the contract slice**

```bash
git add packages/domain/src/mail.ts packages/domain/src/mail.test.ts packages/api-client/src/features/mail.ts packages/api-client/src/client.test.ts
git commit -m "Restore durable Mail draft contracts"
```

---

### Task 2: Restore Provider Delivery Authority and Runtime Policy

**Files:**
- Modify: `packages/connectors/src/types.ts`
- Modify: `packages/connectors/src/google.ts`
- Modify: `packages/connectors/src/google.test.ts`
- Modify: `packages/connectors/src/icloud.ts`
- Modify: `packages/connectors/src/icloud.test.ts`
- Modify: `packages/connectors/package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `scripts/check-provider-network-contract.mjs`
- Modify: `infra/network.tf`
- Modify: `infra/README.md`
- Modify: `docs/deployment.md`

**Interfaces:**
- Produces: `SendRemoteMailInput` with `body`, `cc`, `from`, `subject`, optional provider `threadId`, and `to`.
- Produces: optional `sendMail` on Google and iCloud connector contracts.
- Produces: positive pre-acceptance rejection vs ambiguous post-submission failure classification.

- [ ] **Step 1: Write connector authority and delivery tests**

Add Google tests asserting `gmail.modify` and `gmail.send` are both requested for Mail, that read-only scope projection remains distinct, and that the request goes to `/gmail/v1/users/me/messages/send` with base64url MIME. Add iCloud tests asserting SMTP host `smtp.mail.me.com`, port `587`, `secure: false`, bounded connection/greeting/socket timeouts, and transport closure.

```ts
expect(scopes).toEqual(expect.arrayContaining([
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/gmail.send",
]));
expect(smtpOptions).toMatchObject({
  connectionTimeout: 15_000,
  greetingTimeout: 10_000,
  host: "smtp.mail.me.com",
  port: 587,
  secure: false,
});
```

- [ ] **Step 2: Run connector tests and verify the capability is absent**

Run: `pnpm exec vitest run packages/connectors/src/google.test.ts packages/connectors/src/icloud.test.ts`

Expected: FAIL because send methods, send scope, SMTP, and Nodemailer are absent.

- [ ] **Step 3: Restore connector types and Google delivery**

Restore `SendRemoteMailInput` and `sendMail`. Build MIME with `nodemailer/lib/mail-composer`, refresh credentials before submission, and wrap preparation/authorization failures in `MailSendPreAcceptanceError`. Once `providerFetch` starts the send request, treat every response/transport error as ambiguous unless the shared failure classifier proves non-acceptance.

- [ ] **Step 4: Restore bounded iCloud SMTP delivery**

Restore Nodemailer and send plain text with From, To, Cc, Subject, and optional thread-independent content. Set `connectionTimeout: 15_000`, `greetingTimeout: 10_000`, and `socketTimeout` below the API's 60-second edge budget; always close the transport in `finally`.

- [ ] **Step 5: Restore network contract tests and infrastructure**

Make `scripts/check-provider-network-contract.mjs` require TCP 587 when iCloud sending is compiled, add the exact application security-group egress in `infra/network.tf`, and document STARTTLS SMTP submission in `infra/README.md` and `docs/deployment.md`.

- [ ] **Step 6: Install dependencies and run provider verification**

Run: `pnpm install --lockfile-only=false`

Run: `pnpm exec vitest run packages/connectors/src/google.test.ts packages/connectors/src/icloud.test.ts && node scripts/check-provider-network-contract.mjs`

Expected: PASS.

- [ ] **Step 7: Commit the provider boundary**

```bash
git add packages/connectors pnpm-lock.yaml scripts/check-provider-network-contract.mjs infra/network.tf infra/README.md docs/deployment.md
git commit -m "Restore bounded Mail provider delivery"
```

---

### Task 3: Restore the Durable Draft Service, Routes, and Audit

**Files:**
- Modify: `apps/api/src/connector-service.ts`
- Modify: `apps/api/src/connector-service.integration.test.ts`
- Modify: `apps/api/src/mail-service.ts`
- Modify: `apps/api/src/mail-service.integration.test.ts`
- Modify: `apps/api/src/routes/mail.ts`
- Modify: `apps/api/src/routes/mail.test.ts`
- Modify: `apps/api/src/openapi.ts`

**Interfaces:**
- Consumes: Task 1 draft schemas and Task 2 connector `sendMail`.
- Produces: `ConnectedMailGateway.send(userId, accountId, input): Promise<void>`.
- Produces: `createDraft`, `updateDraft`, `listDrafts`, `deleteDraft`, `sendDraft`, and `reconcileDraft` service methods.

- [ ] **Step 1: Write failing gateway tests for authority and ambiguity**

Cover Google missing `gmail.send`, reconnect health, positively rejected pre-acceptance requests, ambiguous provider calls, rotated credential persistence, and redacted errors. Assert no recipient, subject, or body canary appears in structured error details or logs.

- [ ] **Step 2: Restore and tighten `ConnectedMailGateway.send`**

Use this interface:

```ts
send(
  userId: string,
  accountId: string,
  input: SendRemoteMailInput,
): Promise<void>;
```

Load the owned Mail-enabled account, require provider send authority, call the provider once, persist rotated credentials, and distinguish `MailSendPreAcceptanceError` from a possible partial effect. Extend `mailProviderPartialEffectError` with `operation: "send"` and safe recovery metadata only.

- [ ] **Step 3: Write failing draft service integration tests**

Prove all of these independently:

```ts
await service.createDraft(userId, incompleteInput);
await service.updateDraft(userId, draft.id, { ...changed, expectedUpdatedAt: draft.updatedAt });
await expect(service.updateDraft(userId, draft.id, stale)).rejects.toMatchObject({ code: "conflict" });
await expect(service.sendDraft(userId, { draftId, confirmedUpdatedAt }, humanContext)).resolves.toBeUndefined();
expect(gateway.send).toHaveBeenCalledTimes(1);
await expect(service.sendDraft(userId, sameConfirmation, humanContext)).rejects.toMatchObject({ code: "conflict" });
```

Also prove foreign ownership rejection, incomplete recipient rejection at send time, recent concurrent claim rejection, stale claim reconciliation, pre-acceptance release to `draft`, post-submission transition to `reconcile`, human reconciliation to `sent`/`draft`, and audit redaction.

- [ ] **Step 4: Implement draft CRUD with optimistic revisions**

Create incomplete drafts only for owned Mail-enabled accounts. Validate thread/account ownership. Update and delete only `sendStatus = "draft"`; update requires exact `expectedUpdatedAt`. Serialize current send state and map claim fields to `reconciliationState` without exposing claim IDs.

- [ ] **Step 5: Implement exact-revision send claims**

`sendDraft` must:

1. lock the owned row;
2. require at least one To recipient and a non-empty body or subject;
3. require `updatedAt === confirmedUpdatedAt`;
4. atomically set a random claim ID, claim time, and `sending`;
5. call `gateway.send` once with the saved row;
6. settle `sent` and write redacted `mail.sent` audit metadata; or
7. release to `draft` only for proven pre-acceptance rejection, otherwise move to `reconcile`.

Retain the existing 30-minute stale-claim threshold. Never automatically resubmit a stale or ambiguous draft.

- [ ] **Step 6: Replace compatibility stubs with authenticated human routes**

Register:

```text
GET    /v1/mail/drafts
POST   /v1/mail/drafts
PATCH  /v1/mail/drafts/:id
DELETE /v1/mail/drafts/:id
POST   /v1/mail/send
POST   /v1/mail/drafts/:id/reconcile
```

Require Mail feature access and `mail:write` for mutations, and `requireHuman` for send and reconciliation. Update OpenAPI schemas and remove permanent-unavailable claims.

- [ ] **Step 7: Run the server slice**

Run: `pnpm exec vitest run apps/api/src/connector-service.integration.test.ts apps/api/src/mail-service.integration.test.ts apps/api/src/routes/mail.test.ts`

Expected: PASS.

- [ ] **Step 8: Commit the durable send service**

```bash
git add apps/api/src/connector-service.ts apps/api/src/connector-service.integration.test.ts apps/api/src/mail-service.ts apps/api/src/mail-service.integration.test.ts apps/api/src/routes/mail.ts apps/api/src/routes/mail.test.ts apps/api/src/openapi.ts
git commit -m "Restore durable human-confirmed Mail sending"
```

---

### Task 4: Project Send Capability and Build Unified Inbox Navigation

**Files:**
- Modify: `apps/api/src/mail-service.ts`
- Modify: `apps/api/src/mail-service.integration.test.ts`
- Modify: `apps/web/src/features/mail/mail.tsx`
- Modify: `apps/web/src/features/mail/mail.test.ts`
- Modify: `apps/web/src/features/mail/mail-helpers.test.tsx`
- Modify: `apps/web/src/app.tsx`
- Modify: `apps/web/src/app.test.tsx`
- Modify: `apps/web/src/styles.css`

**Interfaces:**
- Consumes: `MailSetupAccount.sendCapability`.
- Produces: sidebar destinations Inbox, Unread, Starred, Snoozed, Sent, Drafts, collapsed Accounts, and secondary More.

- [ ] **Step 1: Add setup projection tests**

Assert `available` for healthy iCloud and Google with send authority, `reconnect` for Google Mail missing the new grant or an account with reconnect health, and `unavailable` when provider delivery is unsupported. Do not expose raw credential scopes.

- [ ] **Step 2: Add failing navigation tests**

Assert one selected `Inbox` link at `/mail`, unified destinations directly beneath it, a collapsed `Accounts` disclosure, no `Unified inbox` disclosure, and no first-position `Stewardship review`. Opening Accounts must reveal source rows and preserve account-scoped URL behavior.

- [ ] **Step 3: Implement unified navigation hierarchy**

Replace `UnifiedInboxNavigation` with direct links. Keep `mailListScopeFromSearch` and account/mailbox query helpers. Default Accounts closed unless the current URL has an account/mailbox scope; warning indicators may force visibility of the affected account summary but not expansion.

- [ ] **Step 4: Move recovery and historical content into the right hierarchy**

Render reconnect impact immediately above the list toolbar. Keep cached threads visible. Move historical records into the Drafts destination and move stewardship/rules to More. Manual Sync becomes an overflow list action with freshness copy.

- [ ] **Step 5: Remove page-like chrome and default desktop selection**

Remove the duplicate workspace heading/action assumptions from `app.tsx`. When desktop threads load with no valid `thread` parameter, select the first visible thread in URL state without mutating unread. Do not auto-select on the mobile breakpoint.

- [ ] **Step 6: Run focused web tests**

Run: `pnpm exec vitest run apps/web/src/app.test.tsx apps/web/src/features/mail/mail.test.ts apps/web/src/features/mail/mail-helpers.test.tsx`

Expected: PASS.

- [ ] **Step 7: Commit unified inbox UX**

```bash
git add apps/api/src/mail-service.ts apps/api/src/mail-service.integration.test.ts apps/web/src/features/mail/mail.tsx apps/web/src/features/mail/mail.test.ts apps/web/src/features/mail/mail-helpers.test.tsx apps/web/src/app.tsx apps/web/src/app.test.tsx apps/web/src/styles.css
git commit -m "Make Mail a unified inbox first"
```

---

### Task 5: Build the Floating Composer and Draft Lifecycle

**Files:**
- Create: `apps/web/src/features/mail/floating-compose.tsx`
- Create: `apps/web/src/features/mail/floating-compose.test.tsx`
- Modify: `apps/web/src/features/mail/mail.tsx`
- Modify: `apps/web/src/styles.css`
- Modify: `apps/web/src/components/icons.ts` only if a required semantic icon is missing

**Interfaces:**
- Consumes: Task 1 typed client methods and `MailSetupAccount[]`.
- Produces: `MailFloatingCompose` with optional `intent: { mode: "new" | "reply" | "forward"; thread?: MailThread; messages?: MailMessage[] }`.

- [ ] **Step 1: Write failing closed/open/focus tests**

Render the component with one healthy account. Assert a single `Compose a message` plus button, click to open From/To/Subject/Message fields, press Escape to close, and verify focus returns to the trigger. Verify reduced-motion rendering and no hidden interactive controls from exiting Motion content.

- [ ] **Step 2: Write failing autosave tests**

Use fake timers. Type meaningful content, advance the idle interval, and assert one create call. Edit again and assert an update with `expectedUpdatedAt`. Assert Send is disabled while saving or after a save error, closing preserves a saved draft, and Discard confirms then deletes.

- [ ] **Step 3: Implement the floating shell**

Reuse Calendar's Motion transition pattern without importing Calendar feature code. Closed mode is one icon button. Open modes are `edit`, `confirm`, `sending`, `success`, `recovery`, and `connection`. Keep the component Mail-owned and use `AnimatePresence`, layout animation, Escape handling, focus restoration, and `prefers-reduced-motion` behavior.

- [ ] **Step 4: Implement draft editor and autosave state**

Create only after meaningful content exists. Debounce saves, serialize saves so an older response cannot replace a newer revision, flush a pending save on intentional close, and warn on page unload only while unsaved content exists. Store the last healthy From account preference locally without storing message content.

- [ ] **Step 5: Implement exact confirmation and send states**

The first Send action flushes autosave, then shows From, To, Cc, and Subject. `Send message` calls `sendMailDraft({ draftId, confirmedUpdatedAt })`. Success closes after an accessible confirmation. Validation returns to edit. Reconnect preserves the draft and shows the connection action. Ambiguous delivery opens recovery and never exposes another Send button until reconciliation returns it to `draft`.

- [ ] **Step 6: Implement bottom-end responsive styling**

Anchor inside the Mail workspace with logical `inset-inline-end`, account for the app sidebar and safe area, cap desktop width, and use a near-full-width bottom sheet on mobile above the app dock. Keep resize handles and reader controls reachable. Do not add Bcc/attachment controls.

- [ ] **Step 7: Run composer tests**

Run: `pnpm exec vitest run apps/web/src/features/mail/floating-compose.test.tsx`

Expected: PASS.

- [ ] **Step 8: Commit the composer**

```bash
git add apps/web/src/features/mail/floating-compose.tsx apps/web/src/features/mail/floating-compose.test.tsx apps/web/src/features/mail/mail.tsx apps/web/src/styles.css apps/web/src/components/icons.ts
git commit -m "Add durable floating Mail composer"
```

---

### Task 6: Add Reply, Forward, Drafts, and Recovery Workflows

**Files:**
- Modify: `apps/web/src/features/mail/mail.tsx`
- Modify: `apps/web/src/features/mail/floating-compose.tsx`
- Modify: `apps/web/src/features/mail/floating-compose.test.tsx`
- Modify: `apps/web/src/features/mail/mail-helpers.test.tsx`
- Modify: `apps/api/src/qa-fixtures.ts`

**Interfaces:**
- Consumes: `MailFloatingCompose.intent` and durable Mail drafts.
- Produces: reader Reply/Forward actions and unified Drafts records with editable/sending/uncertain/sent states.

- [ ] **Step 1: Write failing Reply and Forward tests**

Reply must choose the source account, address the latest relevant external sender, retain thread ID, and show recipients before confirmation. Forward must choose the source account, begin with empty To, include plain-text quoted context, and keep the derived content editable.

- [ ] **Step 2: Add Reply and Forward reader controls**

Place them with reader-local actions. On mobile keep Reply visible and place Forward in overflow. Neither action sends or saves until the composer receives meaningful content.

- [ ] **Step 3: Replace historical strip with a real Drafts view**

List current editable drafts first, then `Historical Ilo drafts` as a labeled compatibility group. Draft rows show account, recipients summary, subject fallback, updated time, and honest state. Opening an editable draft rehydrates the composer; historical records remain export/delete only.

- [ ] **Step 4: Implement delivery-uncertain recovery**

For `reconcile`, show `Delivery uncertain`, provider Sent Mail guidance, `Mark as sent`, and `Not sent — allow retry`. Require confirmation for both outcomes. A `sent` outcome removes it from Drafts; `not_sent` reopens the editable draft without auto-sending.

- [ ] **Step 5: Add QA fixtures for every visible state**

Provide healthy multi-account unified mail, one reconnect account with cached threads, one Google read-capable/reconnect-to-send account, one editable draft, and one uncertain draft. Keep fixtures free of real credentials.

- [ ] **Step 6: Run workflow tests**

Run: `pnpm exec vitest run apps/web/src/features/mail/floating-compose.test.tsx apps/web/src/features/mail/mail-helpers.test.tsx apps/api/src/mail-service.integration.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit reader and recovery workflows**

```bash
git add apps/web/src/features/mail apps/api/src/qa-fixtures.ts
git commit -m "Add Mail reply forward and recovery workflows"
```

---

### Task 7: Reconcile Product, Engineering, and Security Guidance

**Files:**
- Modify: `docs/design/pages/mail.md`
- Modify: `docs/design/system.md`
- Modify: `docs/product/master-design.md`
- Modify: `docs/product/assumptions-audit.md`
- Modify: `docs/engineering/connector-reliability.md`
- Modify: `docs/product/implementation-log.md`
- Modify: `docs/superpowers/specs/2026-08-15-mail-workspace-stewardship-design.md`
- Modify: `docs/superpowers/plans/2026-08-25-mail-no-send-capability-removal.md`
- Modify: repository contract tests that assert no Mail send method/scope/tool

**Interfaces:**
- Consumes: shipped behavior from Tasks 1–6.
- Produces: one consistent human-send product contract while preserving the prohibition on MCP/autonomous sending.

- [ ] **Step 1: Find every stale no-send assertion**

Run:

```bash
rg -n "never sends|does not send|no-send|compose_email|send_email|gmail.send|SMTP|sendMail" docs apps packages scripts infra
```

Classify each result as human product behavior, MCP/autonomous behavior, transactional product email, historical decision, or executable contract.

- [ ] **Step 2: Update durable guidance**

Describe per-message human approval, durable drafts, no automatic retry, redaction, provider authority, and release evidence. Add a top-of-file superseded notice to the old stewardship spec and removal plan linking to the new spec; preserve their original historical content below it.

- [ ] **Step 3: Keep agent sending unavailable**

Do not restore `create_mail_draft` or `send_mail` MCP tools. Update tests so human web/API sending exists while MCP discovery and Mail stewardship operations continue to exclude autonomous transmission.

- [ ] **Step 4: Run contract and documentation checks**

Run: `pnpm lint && pnpm exec vitest run apps/mcp/src/server.test.ts packages/domain/src/mail-stewardship.test.ts apps/web/src/features/mail/stewardship-page.test.tsx`

Expected: PASS with no contradictory current-tense no-send claim.

- [ ] **Step 5: Commit the contract reconciliation**

```bash
git add docs apps/mcp packages/domain/src/mail-stewardship.test.ts apps/web/src/features/mail/stewardship-page.test.tsx
git commit -m "Align Mail guidance with human-confirmed sending"
```

---

### Task 8: Browser Acceptance and Repository Verification

**Files:**
- Modify only files required by failures found in this task.
- Record evidence in the implementation log or PR handoff; do not create screenshots in tracked source directories.

**Interfaces:**
- Consumes: complete feature.
- Produces: deterministic automated and visual evidence.

- [ ] **Step 1: Run focused static and test verification**

Run:

```bash
pnpm lint
pnpm typecheck
pnpm exec vitest run packages/domain/src/mail.test.ts packages/connectors/src/google.test.ts packages/connectors/src/icloud.test.ts apps/api/src/connector-service.integration.test.ts apps/api/src/mail-service.integration.test.ts apps/api/src/routes/mail.test.ts packages/api-client/src/client.test.ts apps/web/src/app.test.tsx apps/web/src/features/mail/mail.test.ts apps/web/src/features/mail/mail-helpers.test.tsx apps/web/src/features/mail/floating-compose.test.tsx
pnpm build
```

Expected: PASS.

- [ ] **Step 2: Start the registered runtime and load deterministic fixtures**

Run `pnpm env:start` in the attached lifecycle session. Use the repository QA fixture path and the current worktree's assigned ports; do not invent a background server command.

- [ ] **Step 3: Execute desktop browser acceptance**

Verify unified Inbox default, collapsed Accounts, prominent reconnect banner with cached mail, search, resizable panes, automatic non-reading selection, compose focus/Escape, From default, autosave, confirmation, success, Reply, Forward, Drafts, and delivery-uncertain recovery. Confirm no recipient/body content appears in browser console or API error payload metadata.

- [ ] **Step 4: Execute mobile browser acceptance**

Verify list-first navigation, explicit reader back, floating button above the mobile dock, bottom-sheet fit at narrow width, visible Reply with Forward in overflow, keyboard focus order, no horizontal overflow, and preserved drafts on navigation.

- [ ] **Step 5: Run the full repository gate**

Run: `pnpm verify`

Expected: PASS. If a pre-existing unrelated failure remains, reproduce it against the task base and report exact evidence; do not weaken or skip the gate.

- [ ] **Step 6: Record external evidence gaps honestly**

Record that local green tests do not prove Google OAuth verification/send grant, production TCP 587 egress, live iCloud authority, or provider acceptance. Name the controlled post-deploy send smoke and owner required before declaring production delivery verified.

- [ ] **Step 7: Commit verification fixes and evidence**

```bash
git diff --name-only
git status --short
git commit -m "Verify unified Mail compose experience"
```

Before the commit, stage each path reported by the two inspection commands individually. Stage no
unrelated path, and do not create an empty commit when no verification fix or tracked evidence
changed.
