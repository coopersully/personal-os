# Mail No-Send Capability Removal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permanently remove Ilo's ability to compose, draft, reply to, forward, or send user email while preserving a bounded read-only path for people to export or delete historical Ilo drafts.

**Architecture:** Remove delivery authority from the provider boundary inward: connector send methods, Google send scope, iCloud SMTP egress, API service behavior, typed clients, MCP discovery, and web affordances all disappear in one release. The former mutation endpoints remain only as typed `410 feature_unavailable` compatibility stubs for one release. Existing `mail_drafts` rows are exposed through a redacted legacy read model with export and owner-scoped deletion; no new row can be created or reconciled.

**Tech Stack:** TypeScript 5.8, Node.js 22, Zod 4, PostgreSQL 17, Drizzle ORM 0.45, Hono 4, React 19, TanStack Query 5, Vitest 3, Testing Library, Terraform, pnpm 11

**Spec:** `docs/superpowers/specs/2026-08-15-mail-workspace-stewardship-design.md`

## Global Constraints

- Ilo must never send user email. Do not retain a disabled feature flag, dormant provider method, SMTP transport, hidden API client method, MCP tool, compose URL, reply button, or alternate forwarding path.
- Transactional product email in `apps/api/src/email-delivery.ts` is not user Mail and remains untouched.
- Historical draft bodies and recipient fields remain private owner-scoped data. They may be listed, exported locally by the signed-in browser, or deleted; they may not be edited, reconciled, transmitted, copied to a provider, or interpreted as authority.
- The old create, reconcile, and send routes return a permanent structured `410 feature_unavailable` response for one compatibility release. New typed clients and MCP discovery must not expose those calls.
- Existing `mail_drafts` storage is retained in this slice. Dropping the table is a later migration after the compatibility/export window and is not authorized by this plan.
- Google Mail read/write support requires `gmail.modify`, not `gmail.send`. Existing grants may contain the old scope, but Ilo must neither request nor use it.
- Remove iCloud SMTP port 587 from the production network contract only after proving no non-Mail runtime depends on that egress rule.
- MCP remains a stateless intent surface. This plan removes tools; it adds no orchestration, fallback, retry, or external client automation.
- Imported mail content is untrusted data and cannot restore delivery authority.
- Existing migrations are immutable. This capability contraction requires no database migration.

---

## Locked File Structure

### Mail-owned files

- `packages/domain/src/mail.ts` — remove send/create/reconcile inputs; expose the read-only `LegacyMailDraft` contract.
- `packages/domain/src/mail.test.ts` — prove public Mail contracts contain no sending inputs and legacy rows redact internal claims.
- `apps/api/src/mail-service.ts` — remove creation, sending, recovery, and reconciliation; retain owner-scoped list and add delete.
- `apps/api/src/mail-service.integration.test.ts` — prove no row creation/transmission path and owner-scoped legacy deletion.
- `apps/api/src/routes/mail.ts` — legacy list/delete plus temporary permanent-unavailable compatibility stubs.
- `apps/api/src/routes/mail.test.ts` — exact 410 response and access-control tests.
- `packages/api-client/src/features/mail.ts` — remove send/create/reconcile methods; expose list/delete legacy drafts.
- `apps/mcp/src/tools/mail.ts` — remove `create_mail_draft` and `send_mail` registration.
- `apps/web/src/features/mail/mail.tsx` — remove compose/reply/recovery flows; add historical draft export/delete.
- `apps/web/src/features/mail/mail.test.tsx` — absence and legacy-data behavior.
- `docs/design/pages/mail.md` — document the no-send product boundary.

### Explicit Integration handoffs

- `apps/api/src/errors.ts` — add `feature_unavailable`, map it to HTTP 410, and include 410 in `AppError.status`.
- `packages/connectors/src/types.ts` — remove `SendRemoteMailInput` and connector send methods.
- `packages/connectors/src/google.ts` — remove Gmail send behavior and scope; make `gmail.modify` sufficient for Mail capability.
- `packages/connectors/src/icloud.ts` — remove SMTP transport and send behavior.
- `packages/connectors/package.json` and `pnpm-lock.yaml` — remove the Mail-only `nodemailer` and `@types/nodemailer` dependencies.
- `apps/api/src/connector-service.ts` — remove `ConnectedMailGateway.send` and pre-acceptance error handling.
- `apps/api/src/connector-service.integration.test.ts` — delete send/retry cases and retain update/sync coverage.
- `apps/mcp/src/tool-catalog.ts` and `apps/mcp/src/server.test.ts` — remove tool metadata, mocks, and discovery expectations.
- `apps/web/src/app.tsx` and `apps/web/src/app.test.tsx` — remove global Mail compose entry and compose-query behavior.
- `apps/web/src/styles.css` — remove compose/recovery-only styles and add bounded legacy-draft styles.
- `scripts/check-provider-network-contract.mjs` — reject reintroduction of iCloud SMTP and Gmail send authority.
- `infra/network.tf`, `infra/README.md`, `docs/engineering/connector-reliability.md`, and `docs/deployment.md` — remove Mail SMTP egress/configuration claims.
- `apps/api/src/qa-fixtures.ts` and `apps/api/src/icloud-uidvalidity-migration.integration.test.ts` — retain legacy fixtures without implying a usable draft workflow.
- `apps/api/src/openapi.ts` — mark compatibility endpoints unavailable/deprecated and document list/delete.

### Deliberately untouched paths

- `apps/api/src/email-delivery.ts` and transactional notification providers
- `packages/database/src/schema.ts`, `packages/database/migrations/**`, and existing `mail_drafts` rows
- inbound sync, mailbox projection, thread/message reads, labels, read/star, snooze, attention items, and Mail rules
- external client automations or scheduled prompts

---

### Task 1: Remove Provider Delivery Authority

**Files:**
- Modify (Integration): `packages/connectors/src/types.ts`
- Modify (Integration): `packages/connectors/src/google.ts`
- Modify (Integration): `packages/connectors/src/google.test.ts`
- Modify (Integration): `packages/connectors/src/icloud.ts`
- Modify (Integration): `packages/connectors/src/icloud.test.ts`
- Modify (Integration): `packages/connectors/package.json`
- Modify (Integration): `pnpm-lock.yaml`
- Modify (Integration): `apps/api/src/connector-service.ts`
- Modify (Integration): `apps/api/src/connector-service.integration.test.ts`

**Interfaces:**
- Removes: `SendRemoteMailInput`, `GoogleConnector.sendMail`, `ICloudConnector.sendMail`, `ConnectedMailGateway.send`, and `MailSendPreAcceptanceError`.
- Preserves: sync, thread update, rules, and all transactional product-email interfaces.

- [ ] **Step 1: Make connector tests state the negative capability**

```ts
it("requests Mail projection authority without Gmail send authority", () => {
  const url = new URL(connector.authorizationUrl({ state: "state" }));
  const scopes = url.searchParams.get("scope")?.split(" ") ?? [];
  expect(scopes).toContain("https://www.googleapis.com/auth/gmail.modify");
  expect(scopes).not.toContain("https://www.googleapis.com/auth/gmail.send");
});

it("reports Google Mail available from gmail.modify alone", () => {
  expect(googleGrantedServices(["https://www.googleapis.com/auth/gmail.modify"])).toContain("mail");
});

it("does not expose a provider send method", () => {
  expect("sendMail" in connector).toBe(false);
});
```

- [ ] **Step 2: Run the focused tests and observe the current send capability**

Run: `pnpm exec vitest run packages/connectors/src/google.test.ts packages/connectors/src/icloud.test.ts apps/api/src/connector-service.integration.test.ts`

Expected: FAIL because the connectors request/expose delivery and the gateway still has `send`.

- [ ] **Step 3: Contract the connector types and implementations**

Delete the send input/type members rather than replacing them with no-op functions. In `google.ts`, remove the Gmail MIME composer and send request, request only `gmail.modify`, and calculate Mail service availability from `gmail.modify` (or the existing full-mail scope). In `icloud.ts`, delete `createSmtpTransport`, the SMTP send implementation, and nodemailer imports. In `connector-service.ts`, leave the exact narrowed gateway shape:

```ts
export type ConnectedMailGateway = {
  update(input: ConnectedMailUpdateInput): Promise<ConnectedMailUpdateResult>;
};
```

Remove `nodemailer` and `@types/nodemailer` only after `rg -n "nodemailer|createTransport" apps packages` shows no remaining use.

- [ ] **Step 4: Re-run connector and gateway tests**

Run: `pnpm exec vitest run packages/connectors/src/google.test.ts packages/connectors/src/icloud.test.ts apps/api/src/connector-service.integration.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the provider-boundary contraction**

```bash
git add packages/connectors apps/api/src/connector-service.ts apps/api/src/connector-service.integration.test.ts pnpm-lock.yaml
git commit -m "Remove mail provider delivery authority"
```

---

### Task 2: Replace Draft Mutations with a Legacy Read/Delete Contract

**Files:**
- Modify: `packages/domain/src/mail.ts`
- Modify: `packages/domain/src/mail.test.ts`
- Modify (Integration): `packages/domain/src/index.ts`
- Modify: `apps/api/src/mail-service.ts`
- Modify: `apps/api/src/mail-service.integration.test.ts`
- Modify: `apps/api/src/routes/mail.ts`
- Create: `apps/api/src/routes/mail.test.ts`
- Modify (Integration): `apps/api/src/errors.ts`
- Modify (Integration): shared error schema if `ErrorCode` is also exported by `@personal-os/domain`
- Modify (Integration): `apps/api/src/openapi.ts`

**Interfaces:**
- Removes: `MailDraftInput`, `SendMailInput`, `ReconcileMailDraftInput`, and their schemas from the public domain barrel.
- Produces: `LegacyMailDraft`, `MailService.listLegacyDrafts(userId)`, `MailService.deleteLegacyDraft(userId, id)`, `GET /v1/mail/drafts`, and `DELETE /v1/mail/drafts/:id`.
- Temporarily preserves only transport compatibility for three POST endpoints with a permanent 410 response.

- [ ] **Step 1: Write failing domain and route tests**

```ts
it("projects historical rows without recovery or provider authority", () => {
  expect(legacyMailDraftSchema.parse({
    accountId,
    body: "Unsent body",
    cc: [],
    createdAt: now,
    deliveryState: "delivery_unknown",
    id: draftId,
    subject: "Historical draft",
    threadId: null,
    to: ["person@example.com"],
    updatedAt: now,
  })).not.toHaveProperty("sendClaimToken");
});

it.each(["/v1/mail/drafts", "/v1/mail/drafts/id/reconcile", "/v1/mail/send"])(
  "returns a permanent unavailable error for POST %s",
  async (path) => {
    const response = await request(path, { method: "POST", body: "{}" });
    expect(response.status).toBe(410);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "feature_unavailable", details: { capability: "email_transmission", permanent: true } },
    });
  },
);
```

- [ ] **Step 2: Run the focused tests and verify they fail**

Run: `pnpm exec vitest run packages/domain/src/mail.test.ts apps/api/src/routes/mail.test.ts apps/api/src/mail-service.integration.test.ts`

Expected: FAIL because the legacy schema, 410 code, and delete service do not exist.

- [ ] **Step 3: Add the exact legacy public shape**

```ts
export const legacyMailDraftSchema = z.object({
  accountId: idSchema,
  body: z.string(),
  cc: z.array(z.string().email()),
  createdAt: isoDateTimeSchema,
  deliveryState: z.enum(["unsent", "sent", "delivery_unknown"]),
  id: idSchema,
  subject: z.string(),
  threadId: idSchema.nullable(),
  to: z.array(z.string().email()),
  updatedAt: isoDateTimeSchema,
});
export type LegacyMailDraft = z.infer<typeof legacyMailDraftSchema>;
```

Map persisted `draft` to `unsent`, `sent` to `sent`, and any prior `sending`/reconciliation state to `delivery_unknown`. Never return claim tokens, attempt counters, provider IDs, or reconciliation controls.

- [ ] **Step 4: Delete mutation behavior and install compatibility stubs**

Delete `createDraft`, `send`, `reconcileDraft`, their helpers, and all gateway send calls from `mail-service.ts`. Add owner-scoped list/delete methods. Add `feature_unavailable` to `apps/api/src/errors.ts`, map it to 410, include 410 in the status union, then use one route helper:

```ts
function mailSendingUnavailable(): never {
  throw new AppError("feature_unavailable", "Ilo does not send email.", {
    capability: "email_transmission",
    permanent: true,
  });
}

app.post("/v1/mail/drafts", mailSendingUnavailable);
app.post("/v1/mail/drafts/:id/reconcile", mailSendingUnavailable);
app.post("/v1/mail/send", mailSendingUnavailable);
app.delete("/v1/mail/drafts/:id", async (context) => {
  await mail.deleteLegacyDraft(context.get("principal").userId, context.req.param("id"));
  return context.body(null, 204);
});
```

Ensure the compatibility stubs still pass through authentication and Mail feature access. Mark them deprecated/permanently unavailable in OpenAPI.

- [ ] **Step 5: Prove ownership, deletion, and permanent unavailability**

Run: `pnpm exec vitest run packages/domain/src/mail.test.ts apps/api/src/routes/mail.test.ts apps/api/src/mail-service.integration.test.ts apps/api/src/icloud-uidvalidity-migration.integration.test.ts`

Expected: PASS, including cross-user 404/forbidden behavior and preservation of historical rows across UIDVALIDITY repair.

- [ ] **Step 6: Commit the server contract**

```bash
git add packages/domain apps/api/src/mail-service.ts apps/api/src/mail-service.integration.test.ts apps/api/src/routes/mail.ts apps/api/src/routes/mail.test.ts apps/api/src/errors.ts apps/api/src/openapi.ts apps/api/src/icloud-uidvalidity-migration.integration.test.ts
git commit -m "Make historical mail drafts read only"
```

---

### Task 3: Remove Send Intent from Typed Clients and MCP Discovery

**Files:**
- Modify: `packages/api-client/src/features/mail.ts`
- Modify: `packages/api-client/src/client.test.ts`
- Modify: `apps/mcp/src/tools/mail.ts`
- Modify (Integration): `apps/mcp/src/tool-catalog.ts`
- Modify (Integration): `apps/mcp/src/server.test.ts`

**Interfaces:**
- Removes: `createMailDraft`, `sendMail`, `reconcileMailDraft`, `create_mail_draft`, and `send_mail`.
- Produces: `listLegacyMailDrafts()` and `deleteLegacyMailDraft(id)` for first-party UI compatibility only.

- [ ] **Step 1: Write negative discovery and client-contract tests**

```ts
it("does not publish a mail delivery intent", async () => {
  const names = (await listTools()).tools.map((tool) => tool.name);
  expect(names).not.toContain("create_mail_draft");
  expect(names).not.toContain("send_mail");
});

it("exposes legacy draft disposal but no delivery methods", () => {
  expect(client.listLegacyMailDrafts).toEqual(expect.any(Function));
  expect(client.deleteLegacyMailDraft).toEqual(expect.any(Function));
  expect("sendMail" in client).toBe(false);
  expect("createMailDraft" in client).toBe(false);
  expect("reconcileMailDraft" in client).toBe(false);
});
```

- [ ] **Step 2: Run tests and observe the obsolete surface**

Run: `pnpm exec vitest run packages/api-client/src/client.test.ts apps/mcp/src/server.test.ts`

Expected: FAIL because send/create are still public.

- [ ] **Step 3: Narrow the typed client and tool catalog**

Implement only:

```ts
listLegacyMailDrafts(): Promise<LegacyMailDraft[]>;
deleteLegacyMailDraft(id: string): Promise<void>;
```

against `GET /v1/mail/drafts` and `DELETE /v1/mail/drafts/:id`. Remove the two MCP registrations, catalog entries, schemas, mocks, and snapshots. Do not replace them with a generic action or hidden compatibility tool.

- [ ] **Step 4: Re-run client and MCP tests**

Run: `pnpm exec vitest run packages/api-client/src/client.test.ts apps/mcp/src/server.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit intent-surface removal**

```bash
git add packages/api-client apps/mcp
git commit -m "Remove mail sending from clients and MCP"
```

---

### Task 4: Remove Compose UI and Provide Historical Export/Delete

**Files:**
- Modify: `apps/web/src/features/mail/mail.tsx`
- Create: `apps/web/src/features/mail/mail.test.tsx`
- Modify (Integration): `apps/web/src/app.tsx`
- Modify (Integration): `apps/web/src/app.test.tsx`
- Modify (Integration): `apps/web/src/styles.css`
- Modify (Integration): `apps/api/src/qa-fixtures.ts`

**Interfaces:**
- Removes: `MailComposeButton`, `compose=1`, reply action, compose form, send recovery, and draft mutation queries.
- Produces: a secondary “Historical drafts” panel with local JSON export and owner-scoped deletion.

- [ ] **Step 1: Write failing UI tests for the permanent boundary**

```tsx
it("renders no compose, reply, forward, or send affordance", async () => {
  renderMail();
  expect(await screen.findByText("Inbox")).toBeVisible();
  expect(screen.queryByRole("button", { name: /compose|reply|forward|send/i })).not.toBeInTheDocument();
});

it("exports and deletes a historical draft without editing it", async () => {
  vi.useFakeTimers();
  const createObjectURL = vi.fn(() => "blob:mail-draft");
  const revokeObjectURL = vi.fn();
  Object.defineProperties(URL, {
    createObjectURL: { configurable: true, value: createObjectURL },
    revokeObjectURL: { configurable: true, value: revokeObjectURL },
  });
  const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  renderMail({ legacyDrafts: [legacyDraft] });
  await user.click(await screen.findByRole("button", { name: "Export historical draft" }));
  expect(createObjectURL).toHaveBeenCalledOnce();
  expect(click).toHaveBeenCalledOnce();
  expect(document.querySelector("a[download]")).toBeInTheDocument();
  expect(revokeObjectURL).not.toHaveBeenCalled();
  vi.runAllTimers();
  expect(document.querySelector("a[download]")).not.toBeInTheDocument();
  expect(revokeObjectURL).toHaveBeenCalledWith("blob:mail-draft");
  await user.click(screen.getByRole("button", { name: "Delete historical draft" }));
  expect(api.deleteLegacyMailDraft).toHaveBeenCalledWith(legacyDraft.id);
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run focused web tests and verify old affordances fail the contract**

Run: `pnpm exec vitest run apps/web/src/features/mail/mail.test.tsx apps/web/src/app.test.tsx`

Expected: FAIL because compose/reply/send recovery still render.

- [ ] **Step 3: Remove all composition state and routes**

Delete `MailComposeButton`, compose query parsing, form refs/state, create/send/reconcile mutations, `MailSendRecovery`, reply navigation, `ReplyIcon` imports, and compose-only CSS. A URL containing `?compose=1` must render ordinary Mail and must not open an editor.

- [ ] **Step 4: Add a bounded historical draft panel**

The panel is collapsed unless rows exist. Show account, subject, recipients, updated time in the user's planning timezone, delivery uncertainty, Export, and Delete. Export uses an object URL created from `JSON.stringify(draft, null, 2)`, attaches and clicks a temporary download anchor, then removes the anchor and revokes the URL on the next task so the browser can begin the download. Delete requires the existing confirmation primitive and invalidates only the legacy-draft query. Do not provide copy-to-compose or mailto actions.

- [ ] **Step 5: Re-run UI tests**

Run: `pnpm exec vitest run apps/web/src/features/mail/mail.test.tsx apps/web/src/app.test.tsx`

Expected: PASS at desktop and mobile component widths.

- [ ] **Step 6: Commit the product-surface contraction**

```bash
git add apps/web apps/api/src/qa-fixtures.ts
git commit -m "Remove mail composition from the web app"
```

---

### Task 5: Lock the Network Contract and Document the Invariant

**Files:**
- Modify (Integration): `scripts/check-provider-network-contract.mjs`
- Modify (Integration): `infra/network.tf`
- Modify (Integration): `infra/README.md`
- Modify (Integration): `docs/engineering/connector-reliability.md`
- Modify (Integration): `docs/deployment.md`
- Modify: `docs/design/pages/mail.md`
- Modify: `docs/product/implementation-log.md`

**Interfaces:**
- Removes: production iCloud SMTP egress and documentation claiming Mail delivery.
- Adds: static checks that prevent Gmail send scope, SMTP transport, port 587 Mail egress, and MCP send tools from returning.

- [ ] **Step 1: Extend the boundary checker before changing infrastructure**

Read the Google connector and Mail MCP source beside the existing iCloud/network reads, then add one rejection helper and exact assertions:

```js
function rejectContract(source, pattern, description) {
  if (pattern.test(source)) {
    throw new Error(`Provider network contract forbids ${description}.`);
  }
}

rejectContract(google, /gmail\.send/, "Gmail send authority");
rejectContract(icloud, /smtp\.mail\.me\.com|nodemailer|createTransport/, "iCloud SMTP delivery");
rejectContract(mailMcp, /["'](?:create_mail_draft|send_mail)["']/, "Mail delivery MCP tools");
rejectContract(
  network,
  /description\s*=\s*"iCloud Mail SMTP submission"[\s\S]*?from_port\s*=\s*587/,
  "Mail SMTP egress",
);
```

Delete the old positive SMTP host/587 assertions in the same edit; retain the IMAP 993 and all unrelated provider checks.

- [ ] **Step 2: Run the checker and confirm current infrastructure violates the new contract**

Run: `node scripts/check-provider-network-contract.mjs`

Expected: FAIL on the still-present SMTP egress/documentation until the Terraform and connector edits are complete.

- [ ] **Step 3: Remove SMTP egress and update authoritative docs**

Before changing this external boundary, read `docs/engineering/external-boundary-reliability.md`
and `docs/engineering/connector-reliability.md`. Inventory every TCP/587 and SMTP dependency with
`rg -n "587|smtp\.mail\.me\.com" infra apps packages`, then delete only the iCloud Mail TCP/587
egress rule. Update the reliability/deployment documents to describe iCloud Mail as inbound
projection plus supported provider mutations, not delivery. State plainly in the Mail page: “Ilo
never sends email.” Record the shipped contraction in the implementation log without claiming
stewardship is complete.

Prove the effective-policy change before approval: run
`node scripts/check-provider-network-contract.mjs`, `terraform fmt -check`,
`terraform init -backend=false`, and `terraform validate`. In an authorized infrastructure
environment, inspect and retain a `terraform plan` showing only the intended TCP/587 removal. A
static check or plan is not production reachability evidence; record the remaining post-deploy
provider smoke and observation requirement.

- [ ] **Step 4: Run the complete static and behavioral proof**

Run:

```bash
node scripts/check-provider-network-contract.mjs
rg -n "gmail\.send|smtp\.mail\.me\.com|create_mail_draft|send_mail|sendMail\(|createMailDraft|reconcileMailDraft|MailComposeButton" apps packages infra scripts
pnpm verify
```

Expected: the boundary checker and `pnpm verify` PASS. The `rg` command has no user-Mail delivery hits; manually classify any transactional product-email match before proceeding.

- [ ] **Step 5: Commit the invariant and evidence**

```bash
git add scripts/check-provider-network-contract.mjs infra docs
git commit -m "Enforce Ilo's no-send mail boundary"
```

---

## Completion Evidence

- Tool discovery contains no mail compose/draft/send intent.
- The typed public client contains no mail create/send/reconcile method.
- Google authorization does not request `gmail.send`; Google Mail remains available from `gmail.modify`.
- iCloud exposes no SMTP transport and production grants no Mail SMTP egress.
- All former POST routes return the exact permanent 410 compatibility response and cannot create a row or contact a provider.
- Historical rows can only be owner-listed, browser-exported, or owner-deleted.
- Mail renders no compose, reply, forward, send, or uncertain-send recovery affordance at any route or viewport.
- `pnpm verify` passes.

## Required Follow-up (Not in This Plan)

After the announced compatibility/export window, use a separate reviewed migration to remove the three 410 stubs and drop obsolete `mail_drafts` delivery columns/table only after production evidence shows no rows require export or deletion. That follow-up must not restore or replace delivery functionality.
