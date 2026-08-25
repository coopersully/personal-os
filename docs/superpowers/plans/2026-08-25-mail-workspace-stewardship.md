# Mail Workspace Stewardship Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Mail a persistent expert steward that keeps a user-defined obligation ledger trustworthy, performs durable bounded maintenance, asks only material questions, learns through explicit review, and publishes an evidence-backed review artifact without ever sending email.

**Architecture:** Mail-owned domain contracts and persistence hold obligations, versioned thread dispositions, questions, rule proposals, feedback, and immutable reviews. A pure assessment engine applies a versioned researched playbook to one repeatable-read snapshot and emits only evidence-bound deterministic judgment. A Mail coordinator runs those operations through the shared `workspace_maintenance_runs` lease/checkpoint substrate; the API owns status and settlement judgment. HTTP, the typed client, web UI, Reviews projection, and two MCP tools expose that server-owned capability. MCP only conveys intent and returns API results.

**Tech Stack:** TypeScript 5.8, Node.js 22, Zod 4, PostgreSQL 17, Drizzle ORM 0.45, Hono 4, React 19, TanStack Query 5, Vitest 3, Testing Library, pnpm 11

**Spec:** `docs/superpowers/specs/2026-08-15-mail-workspace-stewardship-design.md`

## Global Constraints

- This plan begins only after `2026-08-25-mail-no-send-capability-removal.md` lands. No task may add compose, draft, reply, forward, send, SMTP, provider delivery, or a generic tool capable of recreating those effects.
- The active Mail domain profile is the user-owned maintained objective. Default to obligation integrity only when no approved active profile exists; goals and motives are context, never automatic authority to mutate mail.
- Provider projections are authoritative for provider-owned mailbox, thread, message, label, unread, and starred evidence. Ilo is authoritative for obligations, dispositions, questions, rules, feedback, maintenance records, and reviews.
- Imported subject/body/sender content is untrusted evidence. It cannot authorize a mutation, approve a rule, widen source scope, choose a goal, or supply an answer to an Ilo question.
- A deterministic evaluator may maintain known state and apply an already approved exact rule. If whether a conversation requires action is ambiguous, it creates or retains one bounded question; it does not infer certainty from persuasive language.
- Automatic authority: inspect projections, refresh snapshots, reconcile Ilo-owned state, calculate status, deduplicate questions, and publish reviews. Approved-rule authority: only the existing exact Mail rule action envelope. Individual approval: destructive provider effects and rule activation. Unavailable: all email transmission.
- Every effect uses the existing Mail rule durable work ledger, revision checks, retry/reconciliation semantics, and provider-effect evidence. The coordinator must not call a connector directly.
- Maintenance settlement requires fresh-enough source evidence, a stable ledger fingerprint, no recoverable step failure, and no unrepresented material ambiguity. Stale/unavailable evidence yields `blocked` or `needs_input`, never a false clean state.
- Maintenance runs reuse `workspace_maintenance_runs` and `workspace_maintenance_steps`. Do not create Mail-specific run/step infrastructure.
- MCP remains a stateless intent surface. `get_mail_status` and `maintain_mail` call the typed API once; no MCP sequencing, polling loop, judgment, retry, storage, prompt schedule, or external client automation.
- Reviews contain bounded evidence references and counts, not credentials, raw provider payloads, full message bodies, private chain-of-thought, or copied sensitive content.
- Existing migrations are immutable. Add one append-only `0072_mail_workspace_stewardship.sql` migration and one journal entry.
- Use existing icons from `@/components/icons`, shared primitives, and current Mail layout tokens. No inline SVG or direct `reicon-react` import.

---

## Locked File Structure

### Mail-owned files

- `packages/domain/src/mail-stewardship.ts` — canonical ledger, status, maintenance, surgical-operation, feedback, and review contracts.
- `packages/domain/src/mail-stewardship.test.ts` — lifecycle, redaction, authority, revision, and cross-field honesty tests.
- `apps/api/src/mail-playbook.ts` — immutable researched playbook release and safe deterministic policy.
- `apps/api/src/mail-playbook.test.ts` — version, source registry, limitations, and authority invariants.
- `apps/api/src/mail-assessment.ts` — pure source freshness, obligation/disposition/question reconciliation, health, fingerprint, and settlement calculations.
- `apps/api/src/mail-assessment.test.ts` — deterministic evidence matrix and anti-inference tests.
- `apps/api/src/mail-stewardship-service.ts` — owner-scoped snapshot, ledger mutations, learning loop, review persistence, and status.
- `apps/api/src/mail-stewardship-service.integration.test.ts` — migration, isolation, concurrency, invalidation, learning, and artifact evidence.
- `apps/api/src/mail-maintenance-service.ts` — shared-run orchestration, idempotent steps, durable retries, verification, and settlement.
- `apps/api/src/mail-maintenance-service.integration.test.ts` — lease loss, resume, rule-work handoff, questions, and terminal states.
- `apps/api/src/routes/mail-stewardship.ts` — status, maintenance, ledger, question, feedback, and review endpoints.
- `apps/api/src/routes/mail-stewardship.test.ts` — authentication, scope, transport, revision, and no-send guarantees.
- `packages/api-client/src/features/mail-stewardship.ts` — typed API surface.
- `apps/mcp/src/tools/mail-stewardship.ts` — `get_mail_status` and `maintain_mail` adapters only.
- `apps/web/src/features/mail/stewardship-page.tsx` — `/mail/review` operational status and review surface.
- `apps/web/src/features/mail/stewardship-page.test.tsx` — setup, active run, questions, blocked state, review, and feedback.
- `apps/web/src/features/mail/thread-stewardship.tsx` — exact-conversation ledger controls.
- `apps/web/src/features/mail/thread-stewardship.test.tsx` — disposition, obligation, question, and revision-conflict behavior.
- `docs/design/pages/mail.md` — shipped stewardship behavior and honest limitations.

### Explicit Integration handoffs

- `packages/database/src/schema.ts` and `packages/database/src/schema.test.ts` — declare six Mail ledger tables and verify constraints.
- `packages/database/migrations/0072_mail_workspace_stewardship.sql` and `packages/database/migrations/meta/_journal.json` — append-only persistence expansion.
- `packages/domain/src/index.ts` — export the Mail stewardship contract.
- `apps/api/src/app.ts` — compose the stewardship and maintenance services and register routes.
- `apps/api/src/openapi.ts` — publish the new HTTP contract.
- `apps/api/src/agent-access-work-items.ts` and tests — project unanswered Mail questions and blocked runs into shared Reviews.
- `apps/api/src/app.ts` and `apps/api/src/main.ts` — expose and invoke the bounded due-Mail-maintenance dispatcher beside the existing Finance pass; do not create a second scheduler.
- `packages/api-client/src/client.ts` and `packages/api-client/src/client.test.ts` — compose and prove the new feature methods.
- `apps/mcp/src/server.ts`, `apps/mcp/src/tool-catalog.ts`, and `apps/mcp/src/server.test.ts` — register/discover the two thin tools.
- `apps/web/src/app.tsx` and `apps/web/src/app.test.tsx` — route `/mail/review` and preserve Mail workspace ownership.
- `apps/web/src/features/mail/mail.tsx` — mount exact-thread stewardship alongside existing read/update controls.
- `apps/web/src/styles.css` — bounded responsive stewardship layouts.
- `apps/api/src/qa-fixtures.ts` — deterministic clean, needs-input, blocked, and reviewed fixture states.
- `docs/product/implementation-log.md` — delivered vertical-slice record.

### Deliberately untouched paths

- user email delivery of every kind, legacy compatibility stubs, and transactional notification email
- external clients, client-side automations, scheduled prompts, and MCP-host state
- direct connector calls from stewardship code
- Calendar/Finance domain judgment or their maintenance coordinators
- model-provider integration; v1 uses explicit user/agent inputs and deterministic evidence only

---

## Canonical Persistence Model

The migration adds:

- `mail_obligations` — one current obligation row with kind, owner, goal links, due/review times, evidence revision, state, confidence, rationale, and closure evidence.
- `mail_thread_dispositions` — append-only revisions with one partial-indexed current row per thread.
- `mail_stewardship_questions` — deduplicated open ambiguity with bounded options, evidence references, and answer.
- `mail_rule_proposals` — generalized candidate plus examples/counterexamples/exceptions; approval links to the existing preview-first `mail_rules` flow.
- `mail_stewardship_feedback` — immutable correct/incorrect/outdated/exception observations against a ledger entity or review.
- `mail_reviews` — immutable artifact bound to profile/playbook/rulebook versions, evidence cutoff, fingerprint, counts, health, questions, effects, and next maintenance.

Private response guidance and Calendar commitment candidates are derived preview artifacts, not a seventh canonical ledger table in v1. A response brief is returned from an exact-thread preview using current evidence and explicit profile facts, is never provider-shaped or transmittable, and is not retained unless the user records its individual facts as obligations/context. Calendar candidates continue through the existing `mail_calendar_commitment_intakes` preview contract and never create an event automatically.

All tables include `user_id`; thread-linked tables use owner-validating service queries and foreign keys where possible. Do not persist copied message body/subject text in these tables.

---

### Task 1: Define the Canonical Mail Stewardship Contract

**Files:**
- Create: `packages/domain/src/mail-stewardship.ts`
- Create: `packages/domain/src/mail-stewardship.test.ts`
- Modify (Integration): `packages/domain/src/index.ts`

**Interfaces:**
- Consumes: shared IDs/timestamps, `materialSourceReferenceSchema`, `maintenanceRequestSchema`, `maintenanceRunSchema`, `maintenanceVerificationSchema`, and `workspaceStatusSchema`.
- Produces: `MailObligation`, `MailDisposition`, `MailStewardshipQuestion`, `MailRuleProposal`, `MailStewardshipFeedback`, `MailResponseBrief`, `MailReview`, `MailStatus`, all surgical inputs, and `MailMaintenanceDispatchResult`.

- [ ] **Step 1: Write failing contract tests**

```ts
it("defaults the workspace to obligation integrity without granting effects", () => {
  const status = mailStatusSchema.parse(cleanStatus);
  expect(status.details.objective.mode).toBe("default_obligation_integrity");
  expect(status.details.authority.unavailable).toContain("send_email");
  expect(status.validNextOperations).not.toContain("send_mail");
});

it("requires revision-bound evidence and a rationale for every obligation", () => {
  expect(mailObligationSchema.safeParse({ ...obligation, evidence: [], rationale: "" }).success)
    .toBe(false);
});

it("cannot settle clean with stale sources or unanswered material questions", () => {
  expect(mailStatusSchema.safeParse({
    ...cleanStatus,
    freshness: { ...cleanStatus.freshness, state: "stale" },
  }).success).toBe(false);
  expect(mailStatusSchema.safeParse({
    ...cleanStatus,
    details: { ...cleanStatus.details, openQuestionCount: 1 },
  }).success).toBe(false);
});
```

- [ ] **Step 2: Run the contract test and observe the missing module**

Run: `pnpm exec vitest run packages/domain/src/mail-stewardship.test.ts`

Expected: FAIL because the contract does not exist.

- [ ] **Step 3: Add exact ledger enums and surgical inputs**

```ts
export const mailObligationKindSchema = z.enum([
  "reply", "follow_up", "decide", "schedule", "record", "security_review",
]);
export const mailObligationStateSchema = z.enum([
  "open", "waiting", "deferred", "resolved", "dismissed",
]);
export const mailDispositionKindSchema = z.enum([
  "active", "deferred", "waiting", "delegated", "reference", "noise", "resolved",
]);
export const mailStewardshipFeedbackKindSchema = z.enum([
  "correct", "incorrect", "outdated", "exception",
]);

export const createMailObligationInputSchema = z.object({
  dueAt: isoDateTimeSchema.nullable().default(null),
  goalIds: z.array(idSchema).max(25).default([]),
  kind: mailObligationKindSchema,
  nextReviewAt: isoDateTimeSchema.nullable().default(null),
  owner: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("user") }),
    z.object({ kind: z.literal("other"), relationshipRef: z.string().trim().min(1).max(240).nullable() }),
  ]),
  rationale: z.string().trim().min(1).max(1_000),
  sourceMessageId: idSchema.nullable().default(null),
  sourceThreadRevision: isoDateTimeSchema,
});

export const setMailDispositionInputSchema = z.object({
  disposition: mailDispositionKindSchema,
  expectedThreadUpdatedAt: isoDateTimeSchema,
  rationale: z.string().trim().min(1).max(1_000),
});

export const answerMailQuestionInputSchema = z.object({
  answer: z.string().trim().min(1).max(2_000),
  expectedVersion: z.int().positive(),
  generalize: z.boolean().default(false),
});

export const previewMailResponseBriefInputSchema = z.object({
  expectedThreadUpdatedAt: isoDateTimeSchema,
  purpose: z.string().trim().min(1).max(500),
  factsToAddress: z.array(z.string().trim().min(1).max(500)).max(20).default([]),
  openQuestions: z.array(z.string().trim().min(1).max(500)).max(20).default([]),
  toneConsiderations: z.array(z.string().trim().min(1).max(240)).max(10).default([]),
  materialsNeeded: z.array(z.string().trim().min(1).max(240)).max(20).default([]),
});

export const mailResponseBriefSchema = previewMailResponseBriefInputSchema.omit({
  expectedThreadUpdatedAt: true,
}).extend({
  evidence: z.array(materialSourceReferenceSchema).min(1).max(50),
  sourceThreadRevision: isoDateTimeSchema,
  transmittable: z.literal(false),
});
```

Define full output schemas with IDs, timestamps, positive versions, evidence arrays, and safe summaries. `mailReviewSchema` must not contain message body, subject, sender identity, recipient identity, credentials, or raw payload fields.

- [ ] **Step 4: Build Mail status on the shared envelope**

```ts
export const mailStatusDetailsSchema = z.object({
  authority: z.object({
    automatic: z.array(z.string()),
    approvedRule: z.array(z.string()),
    individualApproval: z.array(z.string()),
    unavailable: z.array(z.string()),
  }),
  dispositionCounts: z.record(mailDispositionKindSchema, z.int().nonnegative()),
  effectCounts: z.object({ pending: z.int().nonnegative(), reconcile: z.int().nonnegative(), failed: z.int().nonnegative() }),
  health: z.array(mailHealthDimensionSchema),
  latestReview: mailReviewSummarySchema.nullable(),
  objective: z.object({
    mode: z.enum(["approved_profile", "default_obligation_integrity"]),
    profileId: idSchema.nullable(),
    profileVersion: z.int().positive().nullable(),
    summary: z.string().trim().min(1).max(1_000),
  }),
  obligationCounts: z.record(mailObligationStateSchema, z.int().nonnegative()),
  openQuestionCount: z.int().nonnegative(),
  playbookVersion: semanticVersionSchema,
  rulebookVersion: z.string().trim().min(1).max(200),
});
export const mailStatusSchema = workspaceStatusSchema(mailStatusDetailsSchema).superRefine(assertHonestMailStatus);
```

Add `mailMaintenanceDispatchResultSchema` with `{ run, summary, verification }`, parallel to Finance but Mail-owned.

- [ ] **Step 5: Run tests and commit**

Run: `pnpm exec vitest run packages/domain/src/mail-stewardship.test.ts packages/domain/src/domain.test.ts`

Expected: PASS.

```bash
git add packages/domain/src/mail-stewardship.ts packages/domain/src/mail-stewardship.test.ts packages/domain/src/index.ts
git commit -m "Define mail stewardship contracts"
```

---

### Task 2: Add the Living Ledger Persistence

**Files:**
- Modify (Integration): `packages/database/src/schema.ts`
- Modify (Integration): `packages/database/src/schema.test.ts`
- Create (Integration): `packages/database/migrations/0072_mail_workspace_stewardship.sql`
- Modify (Integration): `packages/database/migrations/meta/_journal.json`
- Create: `apps/api/src/mail-stewardship-service.ts`
- Create: `apps/api/src/mail-stewardship-service.integration.test.ts`

**Interfaces:**
- Produces owner-scoped repository operations under `createMailStewardshipService`.
- Consumes existing `mail_threads`, `mail_messages`, `mail_snoozes`, `mail_rules`, `mail_rule_work_items`, domain profiles/approvals, goals, motives, and generic maintenance runs.

- [ ] **Step 1: Write failing migration and isolation tests**

```ts
it("allows only one current disposition revision per thread", async () => {
  await service.setDisposition(userId, threadId, firstInput, context);
  await service.setDisposition(userId, threadId, secondInput, context);
  const history = await service.listDispositionHistory(userId, threadId);
  expect(history.filter((row) => row.current)).toHaveLength(1);
  expect(history.map((row) => row.version)).toEqual([2, 1]);
});

it("never exposes another user's ledger", async () => {
  await expect(service.getThreadStewardship(otherUserId, threadId)).rejects.toMatchObject({ code: "not_found" });
});
```

- [ ] **Step 2: Run the integration test and verify missing tables**

Run: `pnpm exec vitest run apps/api/src/mail-stewardship-service.integration.test.ts packages/database/src/schema.test.ts`

Expected: FAIL because migration 0072 and the service do not exist.

- [ ] **Step 3: Add the six tables and database invariants**

Use positive version checks, status enums, owner/time indexes, and these uniqueness rules:

```sql
CREATE UNIQUE INDEX mail_thread_dispositions_current_thread_idx
  ON mail_thread_dispositions (thread_id) WHERE current = true;
CREATE UNIQUE INDEX mail_stewardship_questions_open_fingerprint_idx
  ON mail_stewardship_questions (user_id, fingerprint) WHERE status = 'open';
CREATE UNIQUE INDEX mail_obligations_open_identity_idx
  ON mail_obligations (user_id, thread_id, kind, source_revision)
  WHERE state IN ('open', 'waiting', 'deferred');
```

Add foreign keys with cascade for user-owned stewardship and `set null` for evidence that may disappear. Reviews and feedback remain after source deletion but retain only safe references/fingerprints. Register 0072 without changing prior journal entries.

- [ ] **Step 4: Implement transactional owner-scoped serialization**

Expose this exact service boundary:

```ts
export type MailStewardshipService = {
  createObligation(userId: string, threadId: string, input: CreateMailObligationInput, context: MutationContext): Promise<MailObligation>;
  getThreadStewardship(userId: string, threadId: string): Promise<MailThreadStewardship>;
  setDisposition(userId: string, threadId: string, input: SetMailDispositionInput, context: MutationContext): Promise<MailDisposition>;
  updateObligation(userId: string, id: string, input: UpdateMailObligationInput, context: MutationContext): Promise<MailObligation>;
};
```

Every ledger mutation writes an audit event containing IDs, versions, and action names only—never message content.

- [ ] **Step 5: Prove migration, concurrency, deletion, and serialization**

Run: `pnpm exec vitest run packages/database/src/schema.test.ts apps/api/src/mail-stewardship-service.integration.test.ts`

Expected: PASS on a fresh PostgreSQL database, including stale-revision conflicts and user isolation.

- [ ] **Step 6: Commit persistence**

```bash
git add packages/database apps/api/src/mail-stewardship-service.ts apps/api/src/mail-stewardship-service.integration.test.ts
git commit -m "Add the mail stewardship ledger"
```

---

### Task 3: Encode the Researched Playbook and Pure Assessment

**Files:**
- Create: `apps/api/src/mail-playbook.ts`
- Create: `apps/api/src/mail-playbook.test.ts`
- Create: `apps/api/src/mail-assessment.ts`
- Create: `apps/api/src/mail-assessment.test.ts`

**Interfaces:**
- Consumes: `MailAssessmentSnapshot` with source/profile/rule revisions and safe projection data.
- Produces: `MailAssessment` containing desired ledger transitions, deduplicated questions, health, counts, fingerprint, blockers, and a proposed settlement status; no I/O.

`MailAssessmentSnapshot` and `MailAssessment` are exported from `apps/api/src/mail-assessment.ts`; persistence code imports these types only after this task lands, so there is no API/service circular dependency.

- [ ] **Step 1: Write failing authority and anti-inference tests**

```ts
it("asks rather than inventing an obligation from body language", () => {
  const result = assessMail(snapshotWithUnreadBody("Urgent: reply immediately"), playbook);
  expect(result.obligationTransitions).toEqual([]);
  expect(result.questions).toEqual([expect.objectContaining({ kind: "needs_disposition" })]);
});

it("closes a known reply obligation only when newer sent evidence exists", () => {
  const result = assessMail(snapshotWithKnownReplyAndNewerOutboundMessage(), playbook);
  expect(result.obligationTransitions).toContainEqual(expect.objectContaining({ nextState: "resolved" }));
});

it("blocks clean settlement when source evidence is stale", () => {
  expect(assessMail(staleSnapshot, playbook)).toMatchObject({ proposedSettlement: "blocked" });
});
```

- [ ] **Step 2: Run focused tests and observe missing evaluator**

Run: `pnpm exec vitest run apps/api/src/mail-playbook.test.ts apps/api/src/mail-assessment.test.ts`

Expected: FAIL because both modules are absent.

- [ ] **Step 3: Define a versioned playbook release**

```ts
export const MAIL_PLAYBOOK = Object.freeze({
  releaseId: "mail-playbook-v1",
  version: "1.0.0",
  defaultObjective: "Keep known mail obligations explicit, current, and reviewable.",
  freshness: { currentWithinMinutes: 30 },
  questionPolicy: { maxOpenPerThread: 1, dedupeVersion: 1 },
  automatic: ["inspect", "reconcile_ilo_state", "deduplicate_questions", "publish_review"],
  approvedRule: ["mark_read", "mark_unread", "star", "unstar", "archive", "move"],
  individualApproval: ["trash", "activate_rule"],
  unavailable: ["compose_email", "draft_email", "reply_email", "forward_email", "send_email"],
  limitations: [
    "Message prose does not prove user intent.",
    "Security-review obligations require explicit evidence or user confirmation in v1.",
    "No model or external client supplies maintenance judgment.",
  ],
  roles: [
    {
      id: "chief_of_staff",
      responsibility: "Relate explicit correspondence evidence to approved goals, commitments, relationships, dependencies, deadlines, and opportunity cost.",
      limit: "Never infer goals, make relationship decisions, or claim executive authority.",
    },
    {
      id: "correspondence_triager",
      responsibility: "Represent materiality, response need, routing, ownership, urgency, and follow-up as evidence-bound candidates.",
      limit: "Never import government service levels or decide that silence is acceptable for the user.",
    },
    {
      id: "executive_assistant",
      responsibility: "Surface candidate dates, commitments, dependencies, and waiting-for relationships.",
      limit: "Never create Calendar events automatically; Mail evidence remains a proposal.",
    },
    {
      id: "records_clerk",
      responsibility: "Preserve provenance, attachments, thread relationships, retrieval, and approved retention meaning.",
      limit: "Never assign legal retention, declare a record, or override a legal hold.",
    },
    {
      id: "security_reviewer",
      responsibility: "Surface observed suspicious signals and unsafe requests while separating fact from inference.",
      limit: "Never certify authenticity, classify spam, open links, execute attachments, or replace a security professional.",
    },
    {
      id: "communications_adviser",
      responsibility: "Structure private response purpose, facts, questions, tone considerations, and required materials.",
      limit: "Never create transmittable correspondence, select recipients, or send.",
    },
  ],
  research: [
    { id: "uk-correspondence", reviewedAt: "2026-08-15", reviewEveryDays: 365, url: "https://www.gov.uk/government/publications/handling-government-correspondence-guidance" },
    { id: "nara-electronic-messages", reviewedAt: "2026-08-15", reviewEveryDays: 365, url: "https://www.archives.gov/records-mgmt/bulletins/2015/2015-02.html" },
    { id: "nist-sp-800-177-r1", reviewedAt: "2026-08-15", reviewEveryDays: 180, url: "https://csrc.nist.gov/pubs/sp/800/177/r1/final" },
    { id: "cisa-phishing", reviewedAt: "2026-08-15", reviewEveryDays: 180, url: "https://www.cisa.gov/sites/default/files/2023-09/CISA_Web-Page-Animation_Phishing_Audio-Description.pdf" },
    { id: "gmail-labels", reviewedAt: "2026-08-15", reviewEveryDays: 180, url: "https://developers.google.com/workspace/gmail/api/guides/labels" },
  ],
} as const);
```

Research informs bounded practices; it must not silently enlarge authority. A relevant standards, provider, security, or product-policy change triggers review before the maximum interval.

- [ ] **Step 4: Implement deterministic assessment rules**

The evaluator may:

- preserve explicit obligations and current dispositions;
- derive `deferred` from an active Ilo snooze;
- resolve a known reply obligation from a newer outbound provider-projected message;
- flag stale/missing source evidence and unresolved/reconcile/failed rule effects;
- create one `needs_disposition` question for a materially surfaced thread (starred, attention-linked, goal-linked, or approved-rule-matched) without a current disposition;
- apply only exact enabled rule matches by emitting work intentions for the existing rule service;
- compute a SHA-256 fingerprint from sorted IDs/revisions/profile/playbook/rule versions, never message content.

It may not infer owner, deadline, delegation, intent, security risk, importance, or reusable preference from prose alone.

- [ ] **Step 5: Run pure tests and commit**

Run: `pnpm exec vitest run apps/api/src/mail-playbook.test.ts apps/api/src/mail-assessment.test.ts`

Expected: PASS with fixed clocks and stable fingerprints.

```bash
git add apps/api/src/mail-playbook.ts apps/api/src/mail-playbook.test.ts apps/api/src/mail-assessment.ts apps/api/src/mail-assessment.test.ts
git commit -m "Add the mail stewardship playbook"
```

---

### Task 4: Implement Surgical Ledger Operations and Learning

**Files:**
- Modify: `apps/api/src/mail-stewardship-service.ts`
- Modify: `apps/api/src/mail-stewardship-service.integration.test.ts`

**Interfaces:**
- Completes the Task 2 service with question answering, feedback, response-brief preview, rule-proposal, snapshot, assessment reconciliation, review, and status operations from Task 1.
- Creates a rule proposal only when an answered question sets `generalize: true`; it never activates a rule.
- Extends `MailStewardshipService` with `snapshot(userId, scope)`, `reconcileAssessment(userId, snapshot, assessment)`, `createReview(userId, snapshot, assessment)`, and `getStatus(userId)` using the pure Task 3 types.

- [ ] **Step 1: Add failing learning-loop tests**

```ts
it("answers one question without generalizing by default", async () => {
  await service.answerQuestion(userId, questionId, { answer: "Reference only", expectedVersion: 1, generalize: false }, context);
  expect(await service.listRuleProposals(userId)).toEqual([]);
});

it("creates a preview-only proposal with examples and exceptions when explicitly generalized", async () => {
  await service.answerQuestion(userId, questionId, { answer: "Treat matching receipts as reference", expectedVersion: 1, generalize: true }, context);
  expect(await service.listRuleProposals(userId)).toEqual([
    expect.objectContaining({ status: "proposed", approvedRuleId: null, examples: expect.any(Array), exceptions: [] }),
  ]);
});
```

- [ ] **Step 2: Run the service test and verify learning is absent**

Run: `pnpm exec vitest run apps/api/src/mail-stewardship-service.integration.test.ts`

Expected: FAIL on question answering/proposal/feedback behavior.

- [ ] **Step 3: Implement revision-checked surgical behavior**

All writes lock the owned row, compare the expected version/thread revision, write the ledger/audit mutation atomically, and return the new public row. Answering a question updates only the linked disposition/obligation fields explicitly represented by the selected answer. `generalize: true` creates a disabled proposal; user activation still flows through existing Mail rule preview and `requireHuman` activation. Response-brief preview validates the exact thread revision and returns only the caller-supplied structured guidance plus evidence references and `transmittable: false`; it neither stores a draft nor creates formatted correspondence.

Feedback behavior is exact:

- `correct`: append evidence; no state mutation.
- `incorrect`: reopen/flag the target and create a correction question.
- `outdated`: invalidate the target against current source revision.
- `exception`: add a proposal exception/counterexample or create a bounded question if no proposal exists.

- [ ] **Step 4: Re-run learning and concurrency tests**

Run: `pnpm exec vitest run apps/api/src/mail-stewardship-service.integration.test.ts`

Expected: PASS; stale versions fail without partial writes and no proposal becomes enabled.

- [ ] **Step 5: Commit surgical operations**

```bash
git add apps/api/src/mail-stewardship-service.ts apps/api/src/mail-stewardship-service.integration.test.ts
git commit -m "Add mail stewardship learning operations"
```

---

### Task 5: Build the Durable Autonomous Maintenance Turn

**Files:**
- Create: `apps/api/src/mail-maintenance-service.ts`
- Create: `apps/api/src/mail-maintenance-service.integration.test.ts`
- Modify (Integration): `apps/api/src/app.ts`
- Modify (Integration): `apps/api/src/main.ts`

**Interfaces:**
- Consumes: `WorkspaceMaintenanceService`, `MailStewardshipService`, pure assessor, existing connector sync trigger, and existing Mail rule-work dispatcher.
- Produces: `maintain(userId, request)`, `runDue(limit)`, and owner-scoped run reads.

- [ ] **Step 1: Write failing durable-turn tests**

```ts
it("resumes after lease loss without repeating a completed step", async () => {
  const first = await maintenance.maintain(userId, request);
  await expireClaim(first.run.id);
  const resumed = await maintenance.runDue(10);
  expect(await steps(first.run.id)).toEqual(expect.arrayContaining([
    expect.objectContaining({ step: "snapshot", status: "completed" }),
    expect.objectContaining({ step: "verify", status: "completed" }),
  ]));
  expect(snapshotSpy).toHaveBeenCalledTimes(1);
  expect(resumed).toHaveLength(1);
});

it("settles with questions instead of guessing", async () => {
  const result = await maintenance.maintain(userId, request);
  expect(result.run.status).toBe("completed_with_questions");
  expect(result.verification?.status).toBe("questions");
});
```

- [ ] **Step 2: Run tests and confirm missing coordinator**

Run: `pnpm exec vitest run apps/api/src/mail-maintenance-service.integration.test.ts`

Expected: FAIL because the coordinator does not exist.

- [ ] **Step 3: Implement the fixed idempotent step graph**

Use these exact steps and keys:

```ts
const MAIL_MAINTENANCE_STEPS = [
  ["refresh_sources", "mail:refresh-sources:v1"],
  ["snapshot", "mail:snapshot:v1"],
  ["assess", "mail:assess:v1"],
  ["reconcile_ledger", "mail:reconcile-ledger:v1"],
  ["dispatch_approved_rules", "mail:dispatch-approved-rules:v1"],
  ["publish_review", "mail:publish-review:v1"],
  ["verify", "mail:verify:v1"],
] as const;
```

`refresh_sources` only enqueues existing connector sync triggers and records pending/current readiness; it does not wait indefinitely. `dispatch_approved_rules` invokes the existing durable rule dispatcher and records counts/effect states, never a connector call. Long passes renew the generic lease. Safe step results contain counts, hashes, timestamps, and IDs only.

- [ ] **Step 4: Implement honest settlement**

Settle:

- `completed` only with current evidence, stable fingerprint, no open material questions, and no pending/reconcile/failed effects;
- `completed_with_questions` when maintenance is otherwise sound but explicit questions remain;
- `blocked` for unavailable sources or authority blockers;
- `failed_recoverable` with retry time for transient sync/rule-work/service failures;
- `failed_terminal` only for invalid invariant/version conditions.

Never map an unavailable count to zero. Publish the review before verify, then verify the review fingerprint against a fresh snapshot; a changed snapshot requeues rather than falsely settles.

- [ ] **Step 5: Attach the shared due-run dispatcher**

Implement `mailMaintenance.dispatchDue(limit)` with `workspaceMaintenance.listDueRunIds("mail", limit)`. Expose `dispatchDueMailMaintenance()` from `apps/api/src/app.ts` beside `dispatchDueFinanceMaintenance()` and invoke it from the existing bounded internal pass in `apps/api/src/main.ts`. Do not add a cron, external automation, or MCP polling loop.

- [ ] **Step 6: Prove crash, retry, effect ambiguity, and settlement paths**

Run: `pnpm exec vitest run apps/api/src/mail-maintenance-service.integration.test.ts apps/api/src/workspace-maintenance-service.integration.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit the coordinator**

```bash
git add apps/api/src/mail-maintenance-service.ts apps/api/src/mail-maintenance-service.integration.test.ts apps/api/src/app.ts apps/api/src/main.ts
git commit -m "Add durable mail maintenance turns"
```

---

### Task 6: Expose Server-Owned Status and Surgical HTTP APIs

**Files:**
- Create: `apps/api/src/routes/mail-stewardship.ts`
- Create: `apps/api/src/routes/mail-stewardship.test.ts`
- Modify (Integration): `apps/api/src/app.ts`
- Modify (Integration): `apps/api/src/openapi.ts`
- Create: `packages/api-client/src/features/mail-stewardship.ts`
- Modify (Integration): `packages/api-client/src/client.ts`
- Modify (Integration): `packages/api-client/src/client.test.ts`

**Interfaces:**
- Read: `GET /v1/mail/status`, `GET /v1/mail/maintenance/:id`, `GET /v1/mail/threads/:id/stewardship`, `GET /v1/mail/reviews/:id`.
- Write: `POST /v1/mail/maintenance`, response-brief preview, obligation create/update, disposition set, question answer, feedback create.

- [ ] **Step 1: Write failing route/client tests**

```ts
it("dispatches maintenance and returns the API's honest run state", async () => {
  const response = await client.maintainMail({ scope: { type: "all_outstanding" } });
  expect(response).toMatchObject({ run: { domain: "mail" }, verification: expect.anything() });
});

it("requires mail:write for surgical mutations and mail:read for status", async () => {
  expect(await statusWithReadOnlyToken()).toHaveProperty("status", 200);
  expect(await answerWithReadOnlyToken()).toHaveProperty("status", 403);
});
```

- [ ] **Step 2: Run tests and verify missing routes/client**

Run: `pnpm exec vitest run apps/api/src/routes/mail-stewardship.test.ts packages/api-client/src/client.test.ts`

Expected: FAIL.

- [ ] **Step 3: Register the exact route surface**

```text
GET    /v1/mail/status
POST   /v1/mail/maintenance
GET    /v1/mail/maintenance/:id
GET    /v1/mail/reviews/:id
GET    /v1/mail/threads/:id/stewardship
PUT    /v1/mail/threads/:id/disposition
POST   /v1/mail/threads/:id/obligations
POST   /v1/mail/threads/:id/response-brief/preview
PATCH  /v1/mail/obligations/:id
POST   /v1/mail/questions/:id/answer
POST   /v1/mail/feedback
```

All handlers parse canonical schemas, use principal user ownership, and inject mutation context. Maintenance accepts the shared `maintenanceRequestSchema`; the server chooses the playbook/rulebook versions.

- [ ] **Step 4: Mirror routes in one typed feature client**

Export `getMailStatus`, `maintainMail`, `getMailMaintenanceRun`, `getMailReview`, `getMailThreadStewardship`, `previewMailResponseBrief`, `setMailDisposition`, `createMailObligation`, `updateMailObligation`, `answerMailQuestion`, and `createMailStewardshipFeedback`. No client helper sequences these calls or decides completion.

- [ ] **Step 5: Run route/client tests and commit**

Run: `pnpm exec vitest run apps/api/src/routes/mail-stewardship.test.ts packages/api-client/src/client.test.ts`

Expected: PASS.

```bash
git add apps/api/src/routes/mail-stewardship.ts apps/api/src/routes/mail-stewardship.test.ts apps/api/src/app.ts apps/api/src/openapi.ts packages/api-client
git commit -m "Expose mail stewardship APIs"
```

---

### Task 7: Keep MCP a Stateless Intent Surface

**Files:**
- Create: `apps/mcp/src/tools/mail-stewardship.ts`
- Modify (Integration): `apps/mcp/src/server.ts`
- Modify (Integration): `apps/mcp/src/tool-catalog.ts`
- Modify (Integration): `apps/mcp/src/server.test.ts`

**Interfaces:**
- Produces only `get_mail_status` and `maintain_mail`.
- Consumes only typed API-client methods from Task 6.

- [ ] **Step 1: Write failing discovery and one-call tests**

```ts
it("publishes the two stateless Mail stewardship intents", async () => {
  expect((await listTools()).tools.map(({ name }) => name)).toEqual(expect.arrayContaining([
    "get_mail_status", "maintain_mail",
  ]));
});

it("delegates maintain_mail once and returns the API result unchanged", async () => {
  await callTool("maintain_mail", { scope: { type: "all_outstanding" } });
  expect(api.maintainMail).toHaveBeenCalledTimes(1);
  expect(api.getMailStatus).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run MCP tests and observe missing tools**

Run: `pnpm exec vitest run apps/mcp/src/server.test.ts`

Expected: FAIL.

- [ ] **Step 3: Register thin adapters with honest annotations**

`get_mail_status` is read-only/idempotent/closed-world. `maintain_mail` is write/non-idempotent/open-world because approved rules may enqueue provider mutations; its description must state that Ilo never sends email and the API owns scope, authority, retry, questions, and settlement. Both handlers call exactly one typed API method through `apiResult`.

- [ ] **Step 4: Run MCP tests and commit**

Run: `pnpm exec vitest run apps/mcp/src/server.test.ts`

Expected: PASS with no create/send tools present.

```bash
git add apps/mcp
git commit -m "Expose stateless mail stewardship intents"
```

---

### Task 8: Project Questions into Shared Reviews

**Files:**
- Modify (Integration): `apps/api/src/agent-access-work-items.ts`
- Modify (Integration): `apps/api/src/agent-access-work-items.integration.test.ts`

**Interfaces:**
- Consumes: open `mail_stewardship_questions` and blocked/awaiting-input Mail maintenance runs.
- Produces: shared Reviews work items linking back to `/mail/review` or exact thread stewardship.

- [ ] **Step 1: Write failing projection tests**

```ts
it("projects one redacted review item per open Mail question", async () => {
  const result = await service.list(userPrincipal, { domain: "mail" });
  expect(result.items).toContainEqual(expect.objectContaining({
    domain: "mail",
    kind: "question",
    actionUrl: `/mail/review?question=${questionId}`,
  }));
  expect(JSON.stringify(result.items)).not.toContain(messageBody);
});
```

- [ ] **Step 2: Run the shared projection test and verify Mail questions are absent**

Run: `pnpm exec vitest run apps/api/src/agent-access-work-items.integration.test.ts`

Expected: FAIL.

- [ ] **Step 3: Add bounded Mail projections**

Expose safe question kind, age, account/thread opaque IDs, reason, and action URL. Never copy message subject/body/address data into the shared snapshot. Dedupe questions already represented by an active blocked run.

- [ ] **Step 4: Re-run and commit**

Run: `pnpm exec vitest run apps/api/src/agent-access-work-items.integration.test.ts`

Expected: PASS.

```bash
git add apps/api/src/agent-access-work-items.ts apps/api/src/agent-access-work-items.integration.test.ts
git commit -m "Project mail questions into Reviews"
```

---

### Task 9: Build the Mail Workspace and Review Artifact UI

**Files:**
- Create: `apps/web/src/features/mail/stewardship-page.tsx`
- Create: `apps/web/src/features/mail/stewardship-page.test.tsx`
- Create: `apps/web/src/features/mail/thread-stewardship.tsx`
- Create: `apps/web/src/features/mail/thread-stewardship.test.tsx`
- Modify (Integration): `apps/web/src/features/mail/mail.tsx`
- Modify (Integration): `apps/web/src/app.tsx`
- Modify (Integration): `apps/web/src/app.test.tsx`
- Modify (Integration): `apps/web/src/styles.css`
- Modify (Integration): `apps/api/src/qa-fixtures.ts`

**Interfaces:**
- `/mail/review` presents objective, source freshness, maintenance lifecycle, health, obligations, questions, effects, and immutable review evidence.
- Exact thread view presents current disposition and obligations with surgical controls.

- [ ] **Step 1: Write failing workspace and thread tests**

```tsx
it("shows needs-input honestly and answers the exact question", async () => {
  renderStewardship({ status: needsInputStatus });
  expect(await screen.findByText("Needs your input")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Reference only" }));
  expect(api.answerMailQuestion).toHaveBeenCalledWith(question.id, {
    answer: "reference",
    expectedVersion: question.version,
    generalize: false,
  });
});

it("never renders an email transmission action", async () => {
  renderStewardship({ status: cleanStatus });
  expect(screen.queryByRole("button", { name: /compose|reply|forward|send/i })).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run focused UI tests and verify missing surfaces**

Run: `pnpm exec vitest run apps/web/src/features/mail/stewardship-page.test.tsx apps/web/src/features/mail/thread-stewardship.test.tsx apps/web/src/app.test.tsx`

Expected: FAIL.

- [ ] **Step 3: Build `/mail/review` from status, not client judgment**

Render the API-provided state verbatim: Clean, Needs work, Needs your input, or Blocked. Show freshness with cutoff, current objective/profile version, obligations by state/kind, unanswered questions, pending/reconcile/failed effects, current/last maintenance, and the immutable review artifact. “Maintain Mail” calls `maintainMail` once and then invalidates status/run queries; it does not poll or decide completion itself.

- [ ] **Step 4: Build exact-thread surgical controls**

Mount `ThreadStewardship` beside the selected conversation. It reads the exact-thread contract and provides disposition, obligation state, question answer, feedback, private response-brief preview, Calendar commitment-intake handoff, and optional “propose as a rule” actions. The response brief is visibly an advisory checklist, has no recipient/body field and no copy/mailto action, and carries `transmittable: false`. Commitment evidence links to the existing Calendar preview and never creates an event automatically. Revision conflicts re-fetch and show the changed evidence before retry is offered.

- [ ] **Step 5: Integrate navigation and deterministic fixtures**

Add a Mail secondary-navigation entry for Stewardship/Review and register `/mail/review` without changing domain ownership. Fixtures must cover clean/current, needs-input, blocked source, ambiguous effect, and immutable reviewed state. Use shared tokens and icons; keep mobile controls reachable and labeled.

- [ ] **Step 6: Run component and acceptance tests**

Run: `pnpm exec vitest run apps/web/src/features/mail/stewardship-page.test.tsx apps/web/src/features/mail/thread-stewardship.test.tsx apps/web/src/app.test.tsx`

Expected: PASS.

- [ ] **Step 7: Commit the workspace UI**

```bash
git add apps/web apps/api/src/qa-fixtures.ts
git commit -m "Build the mail stewardship workspace"
```

---

### Task 10: Document, Verify, and Publish the Review Evidence

**Files:**
- Modify: `docs/design/pages/mail.md`
- Modify: `docs/product/implementation-log.md`

- [ ] **Step 1: Document the shipped contract and limitations**

Describe the ledger, roles, playbook version, maintenance stages, authority table, learning loop, status meanings, review artifact, shared Reviews projection, and the permanent sentence “Ilo never sends email.” State that v1 does not infer intent from prose, does not use model judgment, and does not run external client automation.

- [ ] **Step 2: Run targeted cross-layer proof**

```bash
pnpm exec vitest run packages/domain/src/mail-stewardship.test.ts
pnpm exec vitest run apps/api/src/mail-playbook.test.ts apps/api/src/mail-assessment.test.ts
pnpm exec vitest run apps/api/src/mail-stewardship-service.integration.test.ts apps/api/src/mail-maintenance-service.integration.test.ts
pnpm exec vitest run apps/api/src/routes/mail-stewardship.test.ts apps/api/src/agent-access-work-items.integration.test.ts
pnpm exec vitest run apps/mcp/src/server.test.ts
pnpm exec vitest run apps/web/src/features/mail/stewardship-page.test.tsx apps/web/src/features/mail/thread-stewardship.test.tsx
```

Expected: PASS.

- [ ] **Step 3: Run contract scans and full verification**

```bash
rg -n "send_email|send_mail|create_mail_draft|gmail\.send|smtp\.mail\.me\.com" apps packages infra scripts docs/design/pages/mail.md
pnpm verify
```

Expected: `pnpm verify` PASS. The scan contains only explicit unavailable/no-send assertions or historical compatibility documentation—no callable capability.

- [ ] **Step 4: Manually inspect the four honest states**

Using repository QA fixtures, verify desktop and mobile for:

1. current and clean;
2. current with bounded questions;
3. blocked/unavailable source;
4. ambiguous or failed provider effect.

For each, save the review ID, playbook/profile/rulebook versions, evidence cutoff, ledger fingerprint, source freshness, obligation/question/effect counts, verification status, and next maintenance time. Confirm the artifact contains no copied message body, credentials, or private reasoning.

- [ ] **Step 5: Record the delivered slice and commit**

```bash
git add docs/design/pages/mail.md docs/product/implementation-log.md
git commit -m "Document mail workspace stewardship"
```

---

## Completion Evidence

- The ledger persists every approved entity with ownership, source revision, rationale, confidence, lifecycle, and audit evidence.
- Status changes when source/profile/rule/ledger evidence changes and cannot report clean over stale/unavailable evidence or unanswered material questions.
- Maintenance survives lease loss, resumes idempotently, uses existing provider-effect work, and settles only after fingerprint verification.
- The learning loop distinguishes one-off answers from explicit generalization; proposals remain preview-only until human activation.
- Shared Reviews receives redacted Mail questions and blockers.
- MCP exposes exactly two thin stewardship intents and stores/judges nothing.
- No server, client, connector, MCP, UI, or infrastructure path can send user email.
- `pnpm verify` passes and the immutable review artifact is inspectable in the Mail workspace.
