import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import {
  attentionItems,
  auditEvents,
  calendarAccounts,
  createDatabaseClient,
  type DatabaseClient,
  domainProfiles,
  mailboxes,
  mailDrafts,
  mailMessages,
  mailRules,
  mailRuleWorkItems,
  mailSnoozes,
  mailThreads,
  migrateDatabase,
  users,
} from "@personal-os/database";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { createAuditService } from "./audit.js";
import { type ConnectedMailGateway, MailProviderRejectedError } from "./connector-service.js";
import { errorResponse } from "./errors.js";
import { durableMailRuleActionFingerprint } from "./mail-rule-work.js";
import { createMailService } from "./mail-service.js";
import { registerMailRoutes } from "./routes/mail.js";
import { migrationsWithout } from "./test-migrations.js";
import type { AppEnv } from "./types.js";

describe.sequential("mail service", () => {
  let container: StartedPostgreSqlContainer;
  let database: DatabaseClient;
  let service: ReturnType<typeof createMailService>;
  let userId: string;
  let enabledAccountId: string;
  let disabledAccountId: string;
  let inboxId: string;
  let customLabelId: string;
  let profileId: string;
  let threadId: string;
  let secondThreadId: string;
  let legacyRuleId: string;
  let legacyDisabledApprovedRuleId: string;
  let temporaryMigrationsFolder: string | null = null;
  let setupMigrationsFolder: string | null = null;
  const gateway = {
    send: vi.fn<ConnectedMailGateway["send"]>(async () => undefined),
    update: vi.fn<ConnectedMailGateway["update"]>(async () => undefined),
  };
  const mutationContext = (requestId: string) => ({
    principal: {
      actorId: userId,
      actorType: "user" as const,
      scopes: new Set(["mail:read" as const, "mail:write" as const]),
      userId,
    },
    requestId,
  });

  async function expectDraftClaimReleaseInterference(mode: "failed" | "lost"): Promise<void> {
    const draft = await service.createDraft(userId, {
      accountId: enabledAccountId,
      body: "Original body",
      cc: [],
      subject: "Original subject",
      to: [{ address: "to@example.com", name: null }],
    });
    gateway.send.mockClear();
    const releaseAction =
      mode === "failed" ? "RAISE EXCEPTION 'forced claim release failure';" : "RETURN NULL;";
    await database.pool.query(`
      CREATE OR REPLACE FUNCTION interfere_with_mail_draft_claim_for_test() RETURNS trigger AS $$
      BEGIN
        IF OLD.send_status = 'draft' AND NEW.send_status = 'sending' THEN
          NEW.subject = NEW.subject || ' changed';
        ELSIF OLD.send_status = 'sending' AND NEW.send_status = 'draft' THEN
          ${releaseAction}
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER interfere_with_mail_draft_claim_for_test
      BEFORE UPDATE ON mail_drafts
      FOR EACH ROW EXECUTE FUNCTION interfere_with_mail_draft_claim_for_test();
    `);
    try {
      await expect(
        service.send(
          userId,
          {
            accountId: enabledAccountId,
            body: draft.body,
            cc: draft.cc,
            draftId: draft.id,
            subject: draft.subject,
            to: draft.to,
          },
          mutationContext(`draft-claim-release-${mode}`),
        ),
      ).rejects.toMatchObject({
        code: mode === "failed" ? "service_unavailable" : "conflict",
        message: expect.stringContaining(
          mode === "failed" ? "could not safely release" : "no longer owns the draft claim",
        ),
      });
      expect(gateway.send).not.toHaveBeenCalled();
    } finally {
      await database.pool.query(`
        DROP TRIGGER IF EXISTS interfere_with_mail_draft_claim_for_test ON mail_drafts;
        DROP FUNCTION IF EXISTS interfere_with_mail_draft_claim_for_test();
      `);
    }
  }

  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:17.5-alpine")
      .withDatabase("personal_os")
      .withUsername("personal_os")
      .withPassword("personal_os")
      .start();
    database = createDatabaseClient(container.getConnectionUri());
    const migrationsFolder = resolve(process.cwd(), "packages/database/migrations");
    temporaryMigrationsFolder = await migrationsWithout(migrationsFolder, "ilo-mail-migrations-", [
      "0038_agent_setup_foundation",
      "0039_mail_exact_match_policy_normalization",
      "0040_mail_draft_send_claim",
      "0041_domain_profile_approvals",
      "0042_finance_provider_direction",
      "0043_finance_setup_backfill_state",
      "0044_durable_mail_rule_work",
      "0045_mail_calendar_commitment_intake",
      "0046_mail_calendar_account_hint",
      "0047_icloud_uidvalidity_identity",
      "0048_connector_sync_generation",
    ]);
    await migrateDatabase(database.db, temporaryMigrationsFolder);
    const [user] = await database.db
      .insert(users)
      .values({
        displayName: "Mail Test",
        email: "mail@example.com",
        passwordHash: "unused",
        planningTimezone: "UTC",
      })
      .returning();
    if (!user) throw new Error("Fixture user was not created.");
    userId = user.id;
    const legacyRule = await database.pool.query<{ id: string }>(
      `INSERT INTO mail_rules (user_id, name, query, action, enabled)
       VALUES ($1, 'Legacy archive', 'legacy newsletter', 'archive', true)
       RETURNING id`,
      [userId],
    );
    const migratedRuleId = legacyRule.rows[0]?.id;
    if (!migratedRuleId) throw new Error("Legacy rule fixture was not created.");
    legacyRuleId = migratedRuleId;
    setupMigrationsFolder = await migrationsWithout(migrationsFolder, "ilo-mail-setup-migration-", [
      "0039_mail_exact_match_policy_normalization",
      "0040_mail_draft_send_claim",
      "0041_domain_profile_approvals",
      "0042_finance_provider_direction",
      "0043_finance_setup_backfill_state",
      "0044_durable_mail_rule_work",
      "0045_mail_calendar_commitment_intake",
      "0046_mail_calendar_account_hint",
      "0047_icloud_uidvalidity_identity",
      "0048_connector_sync_generation",
    ]);
    await migrateDatabase(database.db, setupMigrationsFolder);
    const legacyDisabledApproved = await database.pool.query<{ id: string }>(
      `INSERT INTO mail_rules (
         user_id, name, query, action, enabled, policy, version
       )
       VALUES (
         $1, 'Legacy disabled approval', 'legacy disabled', 'mark_read', false, 'approved_rule', 1
       )
       RETURNING id`,
      [userId],
    );
    const disabledApprovedId = legacyDisabledApproved.rows[0]?.id;
    if (!disabledApprovedId) throw new Error("Legacy disabled-approved fixture was not created.");
    legacyDisabledApprovedRuleId = disabledApprovedId;
    await database.pool.query(
      `UPDATE mail_rules
       SET confidence_threshold_basis_points = 9000
       WHERE id = $1`,
      [legacyRuleId],
    );
    await migrateDatabase(database.db, migrationsFolder);
    const [enabled, disabled] = await database.db
      .insert(calendarAccounts)
      .values([
        {
          calendarEnabled: true,
          email: "enabled@example.com",
          label: "Enabled",
          mailEnabled: true,
          provider: "google",
          providerAccountId: "enabled",
          userId,
        },
        {
          calendarEnabled: true,
          email: "disabled@example.com",
          label: "Disabled",
          mailEnabled: false,
          provider: "google",
          providerAccountId: "disabled",
          userId,
        },
      ])
      .returning();
    if (!enabled || !disabled) throw new Error("Fixture accounts were not created.");
    enabledAccountId = enabled.id;
    disabledAccountId = disabled.id;
    const [inbox, customLabel] = await database.db
      .insert(mailboxes)
      .values([
        {
          accountId: enabled.id,
          name: "Inbox",
          provider: "google",
          remoteMailboxId: "INBOX",
          role: "inbox",
          totalCount: 2,
          unreadCount: 1,
          userId,
        },
        {
          accountId: enabled.id,
          name: "Orders",
          provider: "google",
          remoteMailboxId: "Label_Orders",
          role: "custom",
          totalCount: 0,
          unreadCount: 0,
          userId,
        },
      ])
      .returning();
    if (!inbox || !customLabel) throw new Error("Fixture mailboxes were not created.");
    inboxId = inbox.id;
    customLabelId = customLabel.id;
    const [profile] = await database.db
      .insert(domainProfiles)
      .values({
        categories: [],
        domain: "mail",
        instructions: [],
        objective: "Keep mail useful.",
        preferences: {},
        sourceContexts: [],
        status: "draft",
        summary: "Mail setup.",
        userId,
      })
      .returning();
    if (!profile) throw new Error("Fixture profile was not created.");
    profileId = profile.id;
    await database.db.insert(mailboxes).values({
      accountId: disabled.id,
      name: "Hidden inbox",
      provider: "google",
      remoteMailboxId: "INBOX",
      role: "inbox",
      userId,
    });
    const [thread] = await database.db
      .insert(mailThreads)
      .values({
        accountId: enabled.id,
        bodyText: "Full body",
        from: { address: "ada@example.com", name: "Ada" },
        messageCount: 2,
        provider: "google",
        receivedAt: new Date("2026-07-15T13:00:00.000Z"),
        remoteMailboxIds: ["INBOX", "MISSING"],
        remoteThreadId: "thread-1",
        snippet: "Project preview",
        starred: true,
        subject: "Project update",
        to: [{ address: "mail@example.com", name: null }],
        unread: true,
        userId,
      })
      .returning();
    if (!thread) throw new Error("Fixture thread was not created.");
    threadId = thread.id;
    const [secondThread] = await database.db
      .insert(mailThreads)
      .values({
        accountId: enabled.id,
        bodyText: "Second body",
        from: { address: "other@example.com", name: "Other" },
        provider: "google",
        receivedAt: new Date("2026-07-15T12:00:00.000Z"),
        remoteMailboxIds: [],
        remoteThreadId: "thread-2",
        snippet: "Different preview",
        starred: false,
        subject: "Another note",
        to: [],
        unread: false,
        userId,
      })
      .returning();
    if (!secondThread) throw new Error("Second thread fixture was not created.");
    secondThreadId = secondThread.id;
    service = createMailService({
      db: database.db,
      gateway,
      now: () => new Date("2026-07-16T12:00:00.000Z"),
      reviewSigningKey: "mail-review-signing-key-for-tests",
    });
  }, 120_000);

  afterAll(async () => {
    await database.close();
    await container.stop();
    if (temporaryMigrationsFolder)
      await rm(temporaryMigrationsFolder, { force: true, recursive: true });
    if (setupMigrationsFolder) await rm(setupMigrationsFolder, { force: true, recursive: true });
  });

  afterEach(async () => {
    await database.db.delete(mailRuleWorkItems);
  });

  it("preserves and normalizes legacy rules through the setup migration", async () => {
    const [stored] = await database.db
      .select()
      .from(mailRules)
      .where(eq(mailRules.id, legacyRuleId));
    expect(stored).toMatchObject({
      actions: [{ afterDays: 0, mailboxId: null, type: "archive" }],
      condition: { field: "any", operator: "contains", value: "legacy newsletter" },
      enabled: true,
      legacyAction: "archive",
      legacyQuery: "legacy newsletter",
      policy: "approved_rule",
      confidenceThreshold: null,
    });
    await expect(service.listRules(userId)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          condition: { field: "any", operator: "contains", value: "legacy newsletter" },
          id: legacyRuleId,
          policy: "approved_rule",
        }),
      ]),
    );
    const oldWriterRule = await database.pool.query<{ id: string }>(
      `INSERT INTO mail_rules (user_id, name, query, action, enabled)
       VALUES ($1, 'Overlap rule', 'legacy overlap', 'mark_read', true)
       RETURNING id`,
      [userId],
    );
    const oldWriterRuleId = oldWriterRule.rows[0]?.id;
    if (!oldWriterRuleId) throw new Error("Rolling-deploy rule fixture was not created.");
    await expect(service.listRules(userId)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actions: [{ afterDays: 0, mailboxId: null, type: "mark_read" }],
          condition: { field: "any", operator: "contains", value: "legacy overlap" },
          id: oldWriterRuleId,
          policy: "approved_rule",
        }),
      ]),
    );
    const [normalizedLegacyApproval] = await database.db
      .select()
      .from(mailRules)
      .where(eq(mailRules.id, legacyDisabledApprovedRuleId));
    expect(normalizedLegacyApproval).toMatchObject({
      enabled: false,
      policy: "preview",
      version: 2,
    });
  });

  it("enforces coherent Mail draft send states in PostgreSQL", async () => {
    const draft = await service.createDraft(userId, {
      accountId: enabledAccountId,
      body: "State invariant",
      cc: [],
      subject: "State invariant",
      to: [{ address: "to@example.com", name: null }],
    });
    for (const statement of [
      `UPDATE mail_drafts SET send_status = 'unknown' WHERE id = $1`,
      `UPDATE mail_drafts SET send_status = 'sending' WHERE id = $1`,
      `UPDATE mail_drafts SET send_status = 'sent' WHERE id = $1`,
      `UPDATE mail_drafts
       SET send_status = 'draft', send_claimed_at = now()
       WHERE id = $1`,
    ]) {
      await expect(database.pool.query(statement, [draft.id])).rejects.toMatchObject({
        code: "23514",
        constraint: "mail_drafts_send_state_check",
      });
    }
    await database.db.delete(mailDrafts).where(eq(mailDrafts.id, draft.id));
  });

  it("lists enabled mailboxes and serializes mailbox membership", async () => {
    await database.db.insert(mailMessages).values({
      attachments: [
        { contentType: "text/plain", filename: "notes.txt", id: "attachment", size: 4 },
      ],
      bodyText: "Message body",
      cc: [],
      from: { address: "ada@example.com", name: "Ada" },
      receivedAt: new Date("2026-07-15T13:00:00.000Z"),
      remoteMessageId: "message-1",
      threadId,
      to: [],
    });
    await expect(service.listMailboxes(userId)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ accountId: enabledAccountId, id: inboxId, unreadCount: 1 }),
      ]),
    );
    await expect(service.getThread(userId, threadId)).resolves.toMatchObject({
      id: threadId,
      mailboxIds: [inboxId],
      messageCount: 2,
      provider: "google",
    });
    await expect(service.getThread(userId, disabledAccountId)).rejects.toMatchObject({
      code: "not_found",
    });
    await expect(service.listMessages(userId, threadId)).resolves.toEqual([
      expect.objectContaining({ bodyText: "Message body", threadId }),
    ]);
    await expect(service.listMessages(userId, disabledAccountId)).rejects.toMatchObject({
      code: "not_found",
    });
  });

  it("filters conversations by account, unread state, mailbox, and search fields", async () => {
    await expect(service.listThreads(userId, { limit: 100 })).resolves.toHaveLength(2);
    await expect(
      service.listThreads(userId, { accountIds: [], limit: 100, unread: false }),
    ).resolves.toEqual([expect.objectContaining({ subject: "Another note" })]);
    await expect(
      service.listThreads(userId, { accountIds: [enabledAccountId], limit: 100, unread: true }),
    ).resolves.toEqual([expect.objectContaining({ subject: "Project update" })]);
    for (const query of ["Project", "Project preview", "ada@example.com", "Ada"]) {
      await expect(service.listThreads(userId, { limit: 100, query })).resolves.toEqual([
        expect.objectContaining({ id: threadId }),
      ]);
    }
    await expect(service.listThreads(userId, { limit: 100, mailboxId: inboxId })).resolves.toEqual([
      expect.objectContaining({ id: threadId }),
    ]);
    await expect(
      service.listThreads(userId, { limit: 100, mailboxId: disabledAccountId }),
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("writes through mutations and persists drafts and snoozes", async () => {
    const updated = await service.updateThread(
      userId,
      threadId,
      { mailboxIds: [inboxId], starred: false, unread: false },
      { actorId: userId, actorType: "user" },
      "request-1",
    );
    expect(updated).toMatchObject({ starred: false, unread: false });
    expect(gateway.update).toHaveBeenCalledWith(userId, enabledAccountId, "thread-1", {
      addMailboxIds: [],
      removeMailboxIds: ["STARRED", "UNREAD"],
    });
    const draft = await service.createDraft(userId, {
      accountId: enabledAccountId,
      body: "Hello",
      cc: [],
      subject: "Subject",
      to: [{ address: "ada@example.com", name: "Ada" }],
    });
    if (!draft) throw new Error("Draft was not created.");
    await expect(service.listDrafts(userId)).resolves.toEqual([
      expect.objectContaining({ id: draft.id }),
    ]);
    await service.send(
      userId,
      {
        accountId: enabledAccountId,
        body: "Hello",
        cc: [],
        draftId: draft.id,
        subject: "Subject",
        to: [{ address: "ada@example.com", name: "Ada" }],
      },
      mutationContext("send-draft"),
    );
    expect(gateway.send).toHaveBeenCalledWith(userId, enabledAccountId, {
      body: "Hello",
      cc: [],
      subject: "Subject",
      to: [{ address: "ada@example.com", name: "Ada" }],
    });
    await service.send(
      userId,
      {
        accountId: enabledAccountId,
        body: "Reply",
        cc: [],
        subject: "Re: Project update",
        threadId,
        to: [{ address: "ada@example.com", name: "Ada" }],
      },
      mutationContext("send-reply"),
    );
    expect(gateway.send).toHaveBeenLastCalledWith(userId, enabledAccountId, {
      body: "Reply",
      cc: [],
      subject: "Re: Project update",
      threadId: "thread-1",
      to: [{ address: "ada@example.com", name: "Ada" }],
    });
    await expect(database.db.select().from(mailDrafts)).resolves.toEqual([
      expect.objectContaining({ sentAt: expect.any(Date) }),
    ]);
    await service.snoozeThread(userId, threadId, new Date("2026-07-18T12:00:00.000Z"));
    await expect(database.db.select().from(mailSnoozes)).resolves.toEqual([
      expect.objectContaining({ threadId }),
    ]);
    await expect(service.listThreads(userId, { limit: 100 })).resolves.toEqual([
      expect.objectContaining({ subject: "Another note" }),
    ]);
    await database.db
      .update(domainProfiles)
      .set({
        preferences: {
          importantEmailHandling: "inbox_and_attention",
          inboxStyle: "conservative",
          noiseDisposition: "review_only",
        },
        sourceContexts: [],
        status: "active",
      })
      .where(eq(domainProfiles.id, profileId));
    const rule = await service.createRule(
      {
        actions: [{ afterDays: 1, mailboxId: null, type: "trash" }],
        condition: { field: "subject", operator: "contains", value: "Project" },
        confidenceThreshold: null,
        description: "Archive old project updates.",
        enabled: false,
        name: "Archive newsletters",
        policy: "preview",
        profileId,
        sourceIds: [enabledAccountId],
      },
      {
        principal: {
          actorId: userId,
          actorType: "user",
          scopes: new Set(["mail:read", "mail:write"]),
          userId,
        },
        requestId: "request-rule",
      },
    );
    const ruleAudit = await database.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.requestId, "request-rule"));
    expect(ruleAudit).toEqual([
      expect.objectContaining({
        action: "mail.rule.created",
        after: expect.objectContaining({
          actionTypes: ["trash"],
          conditionField: "subject",
          conditionOperator: "contains",
          sourceCount: 1,
        }),
      }),
    ]);
    expect(JSON.stringify(ruleAudit)).not.toMatch(
      /Project|Archive old|Archive newsletters|enabled@example|thread-1/,
    );
    await expect(
      service.previewRule(userId, {
        actions: rule.actions,
        condition: rule.condition,
        confidenceThreshold: null,
        description: rule.description,
        sourceIds: rule.sourceIds,
      }),
    ).resolves.toMatchObject({
      candidates: [expect.objectContaining({ id: threadId })],
      matchedCount: 1,
      window: {
        limit: 200,
        newestReceivedAt: "2026-07-15T13:00:00.000Z",
        oldestReceivedAt: "2026-07-15T12:00:00.000Z",
        truncated: false,
      },
    });
    const reviewed = await service.previewSavedRule(userId, rule.id);
    const activationInput = {
      expectedCandidateIds: reviewed.candidates.map((candidate) => candidate.id),
      expectedPreviewFingerprint: reviewed.fingerprint,
      expectedPreviewedAt: reviewed.previewedAt,
      expectedVersion: rule.version,
    };
    await expect(
      service.activateRule(rule.id, activationInput, {
        principal: {
          actorId: userId,
          actorType: "agent",
          scopes: new Set(["mail:read", "mail:write"]),
          userId,
        },
        requestId: "request-rule-agent-activation",
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      service.activateRule(
        rule.id,
        { ...activationInput, expectedPreviewedAt: "2026-07-16T11:00:00.000Z" },
        {
          principal: {
            actorId: userId,
            actorType: "user",
            scopes: new Set(["mail:read", "mail:write"]),
            userId,
          },
          requestId: "request-rule-expired-review",
        },
      ),
    ).rejects.toThrow("review expired");
    await expect(
      service.activateRule(rule.id, activationInput, {
        principal: {
          actorId: userId,
          actorType: "user",
          scopes: new Set(["mail:read", "mail:write"]),
          userId,
        },
        requestId: "request-rule-missing-profile-source",
      }),
    ).rejects.toThrow("Every rule source must have an explicit meaning");
    await database.db
      .update(domainProfiles)
      .set({
        sourceContexts: [
          {
            notes: null,
            purpose: "Primary inbox",
            sourceId: enabledAccountId,
            sourceLabel: "Enabled",
          },
        ],
      })
      .where(eq(domainProfiles.id, profileId));
    await expect(
      service.activateRule(rule.id, activationInput, {
        principal: {
          actorId: userId,
          actorType: "user",
          scopes: new Set(["mail:read", "mail:write"]),
          userId,
        },
        requestId: "request-rule-review-only",
      }),
    ).rejects.toThrow("does not authorize this retention action and timing");
    await database.db
      .update(domainProfiles)
      .set({
        preferences: {
          importantEmailHandling: "inbox_and_attention",
          inboxStyle: "conservative",
          noiseDisposition: "trash_after_days",
          noiseRetentionDays: 1,
        },
      })
      .where(eq(domainProfiles.id, profileId));
    const oneDayTrashRule = await service.createRule(
      {
        actions: rule.actions,
        condition: rule.condition,
        confidenceThreshold: null,
        description: rule.description,
        enabled: false,
        name: "Discard routine project notices after one day",
        policy: "preview",
        profileId,
        sourceIds: [enabledAccountId],
      },
      mutationContext("request-one-day-trash-rule"),
    );
    const oneDayTrashPreview = await service.previewSavedRule(userId, oneDayTrashRule.id);
    await expect(
      service.activateRule(
        oneDayTrashRule.id,
        {
          expectedCandidateIds: oneDayTrashPreview.candidates.map((candidate) => candidate.id),
          expectedPreviewFingerprint: oneDayTrashPreview.fingerprint,
          expectedPreviewedAt: oneDayTrashPreview.previewedAt,
          expectedVersion: oneDayTrashRule.version,
        },
        mutationContext("request-one-day-trash-activation"),
      ),
    ).resolves.toMatchObject({
      rule: { enabled: true, policy: "approved_rule", version: 2 },
    });
    await expect(
      database.db
        .select()
        .from(mailRuleWorkItems)
        .where(eq(mailRuleWorkItems.ruleId, oneDayTrashRule.id)),
    ).resolves.toEqual([
      expect.objectContaining({
        action: { afterDays: 1, mailboxId: null, type: "trash" },
        dueAt: new Date("2026-07-16T13:00:00.000Z"),
        status: "pending",
      }),
    ]);
    await service.updateRule(
      oneDayTrashRule.id,
      { enabled: false, expectedVersion: 2 },
      mutationContext("request-one-day-trash-pause"),
    );
    const immediateTrashRule = await service.createRule(
      {
        actions: [{ afterDays: 0, mailboxId: null, type: "trash" }],
        condition: rule.condition,
        confidenceThreshold: null,
        description: rule.description,
        enabled: false,
        name: "Immediate Trash is never inferred from retention preferences",
        policy: "preview",
        profileId,
        sourceIds: [enabledAccountId],
      },
      mutationContext("request-immediate-trash-rule"),
    );
    const immediateTrashPreview = await service.previewSavedRule(userId, immediateTrashRule.id);
    await expect(
      service.activateRule(
        immediateTrashRule.id,
        {
          expectedCandidateIds: immediateTrashPreview.candidates.map((candidate) => candidate.id),
          expectedPreviewFingerprint: immediateTrashPreview.fingerprint,
          expectedPreviewedAt: immediateTrashPreview.previewedAt,
          expectedVersion: immediateTrashRule.version,
        },
        mutationContext("request-immediate-trash-activation"),
      ),
    ).rejects.toThrow("does not authorize this retention action and timing");
    const nonRetentionRule = await service.updateRule(
      rule.id,
      {
        actions: [{ afterDays: 0, mailboxId: null, type: "mark_read" }],
        expectedVersion: rule.version,
      },
      {
        principal: {
          actorId: userId,
          actorType: "user",
          scopes: new Set(["mail:read", "mail:write"]),
          userId,
        },
        requestId: "request-rule-non-retention",
      },
    );
    const nonRetentionPreview = await service.previewSavedRule(userId, rule.id);
    await expect(
      service.activateRule(
        rule.id,
        {
          expectedCandidateIds: nonRetentionPreview.candidates.map((candidate) => candidate.id),
          expectedPreviewFingerprint: nonRetentionPreview.fingerprint,
          expectedPreviewedAt: nonRetentionPreview.previewedAt,
          expectedVersion: nonRetentionRule.version,
        },
        {
          principal: {
            actorId: userId,
            actorType: "user",
            scopes: new Set(["mail:read", "mail:write"]),
            userId,
          },
          requestId: "request-rule-update",
        },
      ),
    ).resolves.toMatchObject({
      rule: { enabled: true, policy: "approved_rule", version: 3 },
    });
    await expect(
      service.updateRule(
        rule.id,
        {
          condition: { field: "sender", operator: "contains", value: "changed" },
          expectedVersion: 3,
        },
        {
          principal: {
            actorId: userId,
            actorType: "user",
            scopes: new Set(["mail:read", "mail:write"]),
            userId,
          },
          requestId: "request-rule-active-edit",
        },
      ),
    ).rejects.toMatchObject({ code: "invalid_request" });
    const pausedRule = await service.updateRule(
      rule.id,
      { enabled: false, expectedVersion: 3 },
      mutationContext("request-rule-pause"),
    );
    expect(pausedRule).toMatchObject({ enabled: false, policy: "preview", version: 4 });
    const changedPausedRule = await service.updateRule(
      rule.id,
      {
        condition: { field: "sender", operator: "ends_with", value: "@example.com" },
        expectedVersion: pausedRule.version,
      },
      mutationContext("request-rule-paused-edit"),
    );
    expect(changedPausedRule).toMatchObject({
      enabled: false,
      policy: "preview",
      version: 5,
    });
    const reactivationPreview = await service.previewSavedRule(userId, rule.id);
    await expect(
      service.activateRule(
        rule.id,
        {
          expectedCandidateIds: reactivationPreview.candidates.map((candidate) => candidate.id),
          expectedPreviewFingerprint: reactivationPreview.fingerprint,
          expectedPreviewedAt: reactivationPreview.previewedAt,
          expectedVersion: changedPausedRule.version,
        },
        mutationContext("request-rule-reactivate"),
      ),
    ).resolves.toMatchObject({
      rule: { enabled: true, policy: "approved_rule", version: 6 },
    });
    await expect(service.listRules(userId)).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ enabled: true, id: rule.id, version: 6 })]),
    );
    await expect(database.db.select().from(mailRules)).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: rule.id })]),
    );
    await database.db
      .update(domainProfiles)
      .set({ preferences: {}, sourceContexts: [], status: "draft" })
      .where(eq(domainProfiles.id, profileId));
  });

  it("durably audits successful sends without exposing message content to audit readers", async () => {
    const draft = await service.createDraft(userId, {
      accountId: enabledAccountId,
      body: "Private draft body",
      cc: [{ address: "private-copy@example.com", name: null }],
      subject: "Private draft subject",
      to: [{ address: "private-to@example.com", name: null }],
    });
    if (!draft) throw new Error("Draft fixture was not created.");
    await service.send(
      userId,
      {
        accountId: enabledAccountId,
        body: draft.body,
        cc: draft.cc,
        draftId: draft.id,
        subject: draft.subject,
        to: draft.to,
      },
      mutationContext("redacted-send-draft"),
    );
    await service.send(
      userId,
      {
        accountId: enabledAccountId,
        body: "Private reply body",
        cc: [],
        subject: "Private reply subject",
        threadId,
        to: [{ address: "private-reply@example.com", name: null }],
      },
      mutationContext("redacted-send-reply"),
    );

    const sentAudits = (await createAuditService(database.db).list(userId, 100)).filter((event) =>
      ["redacted-send-draft", "redacted-send-reply"].includes(event.requestId),
    );
    expect(sentAudits).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actorId: userId,
          action: "mail.sent",
          after: {
            accountId: enabledAccountId,
            ccCount: 1,
            draftId: draft.id,
            hasDraft: true,
            hasThread: false,
            recipientCount: 1,
            threadId: null,
          },
          requestId: "redacted-send-draft",
        }),
        expect.objectContaining({
          actorId: userId,
          action: "mail.sent",
          after: {
            accountId: enabledAccountId,
            ccCount: 0,
            draftId: null,
            hasDraft: false,
            hasThread: true,
            recipientCount: 1,
            threadId,
          },
          requestId: "redacted-send-reply",
        }),
      ]),
    );
    const serializedSentAudits = JSON.stringify(sentAudits);
    for (const privateContent of [
      "private-copy@example.com",
      "private-to@example.com",
      "private-reply@example.com",
      "Private draft body",
      "Private draft subject",
      "Private reply body",
      "Private reply subject",
    ]) {
      expect(serializedSentAudits).not.toContain(privateContent);
    }
  });

  it("rolls back draft sent state and reports a possible send when its audit fails", async () => {
    gateway.send.mockClear();
    const draft = await service.createDraft(userId, {
      accountId: enabledAccountId,
      body: "Send once",
      cc: [],
      subject: "Provider partial send",
      to: [{ address: "ada@example.com", name: "Ada" }],
    });
    if (!draft) throw new Error("Draft fixture was not created.");
    await database.pool.query(`
      CREATE OR REPLACE FUNCTION fail_mail_sent_audit_for_test() RETURNS trigger AS $$
      BEGIN
        IF NEW.action = 'mail.sent' THEN
          RAISE EXCEPTION 'forced mail sent audit failure';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER fail_mail_sent_audit_for_test
      BEFORE INSERT ON audit_events
      FOR EACH ROW EXECUTE FUNCTION fail_mail_sent_audit_for_test();
    `);
    try {
      await expect(
        service.send(
          userId,
          {
            accountId: enabledAccountId,
            body: draft.body,
            cc: draft.cc,
            draftId: draft.id,
            subject: draft.subject,
            to: draft.to,
          },
          mutationContext("send-draft-audit-failure"),
        ),
      ).rejects.toMatchObject({
        code: "service_unavailable",
        details: {
          accountId: enabledAccountId,
          credentialPersistenceMayHaveFailed: false,
          draftId: draft.id,
          operation: "send",
          partialEffect: true,
          repairAction: "verify_sent_mail_then_reconcile_draft",
        },
      });
      expect(gateway.send).toHaveBeenCalledOnce();
      const [unsentDraft] = await database.db
        .select()
        .from(mailDrafts)
        .where(eq(mailDrafts.id, draft.id));
      expect(unsentDraft).toMatchObject({ sendStatus: "reconcile", sentAt: null });
      await expect(
        service.send(
          userId,
          {
            accountId: enabledAccountId,
            body: draft.body,
            cc: draft.cc,
            draftId: draft.id,
            subject: draft.subject,
            to: draft.to,
          },
          mutationContext("send-draft-after-partial"),
        ),
      ).rejects.toMatchObject({
        code: "conflict",
        details: expect.objectContaining({
          repairAction: "verify_sent_mail_then_reconcile_draft",
        }),
      });
      expect(gateway.send).toHaveBeenCalledOnce();
      await expect(
        database.db
          .select()
          .from(auditEvents)
          .where(eq(auditEvents.requestId, "send-draft-audit-failure")),
      ).resolves.toEqual([]);
    } finally {
      await database.pool.query(`
        DROP TRIGGER IF EXISTS fail_mail_sent_audit_for_test ON audit_events;
        DROP FUNCTION IF EXISTS fail_mail_sent_audit_for_test();
      `);
    }
  });

  it("claims a draft durably so concurrent sends call the provider exactly once", async () => {
    const draft = await service.createDraft(userId, {
      accountId: enabledAccountId,
      body: "Concurrent body",
      cc: [],
      subject: "Concurrent send",
      to: [{ address: "to@example.com", name: null }],
    });
    let releaseProvider: (() => void) | undefined;
    gateway.send.mockClear();
    gateway.send.mockImplementationOnce(
      () =>
        new Promise<void>((resolveProvider) => {
          releaseProvider = resolveProvider;
        }),
    );
    const input = {
      accountId: enabledAccountId,
      body: draft.body,
      cc: draft.cc,
      draftId: draft.id,
      subject: draft.subject,
      to: draft.to,
    };
    const first = service.send(userId, input, mutationContext("concurrent-draft-first"));
    await vi.waitFor(() => expect(gateway.send).toHaveBeenCalledOnce());
    await expect(service.listDrafts(userId)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: draft.id,
          reconciliationState: "in_progress",
          sendStatus: "sending",
        }),
      ]),
    );
    await expect(
      service.send(userId, input, mutationContext("concurrent-draft-second")),
    ).rejects.toMatchObject({
      code: "conflict",
      details: expect.objectContaining({ sendStatus: "sending" }),
    });
    expect(gateway.send).toHaveBeenCalledOnce();
    releaseProvider?.();
    await expect(first).resolves.toBeUndefined();
    await expect(
      database.db.select().from(mailDrafts).where(eq(mailDrafts.id, draft.id)),
    ).resolves.toEqual([expect.objectContaining({ sendStatus: "sent" })]);
  });

  it("revalidates the saved draft after acquiring its send claim", async () => {
    const draft = await service.createDraft(userId, {
      accountId: enabledAccountId,
      body: "Original body",
      cc: [],
      subject: "Original subject",
      to: [{ address: "to@example.com", name: null }],
    });
    gateway.send.mockClear();
    await database.pool.query(`
      CREATE OR REPLACE FUNCTION change_claimed_mail_draft_for_test() RETURNS trigger AS $$
      BEGIN
        IF OLD.send_status = 'draft' AND NEW.send_status = 'sending' THEN
          NEW.subject = NEW.subject || ' changed';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER change_claimed_mail_draft_for_test
      BEFORE UPDATE ON mail_drafts
      FOR EACH ROW EXECUTE FUNCTION change_claimed_mail_draft_for_test();
    `);
    try {
      await expect(
        service.send(
          userId,
          {
            accountId: enabledAccountId,
            body: draft.body,
            cc: draft.cc,
            draftId: draft.id,
            subject: draft.subject,
            to: draft.to,
          },
          mutationContext("changed-during-draft-claim"),
        ),
      ).rejects.toMatchObject({
        code: "invalid_request",
        message: expect.stringContaining("changed before its send claim"),
      });
      expect(gateway.send).not.toHaveBeenCalled();
      await expect(
        database.db.select().from(mailDrafts).where(eq(mailDrafts.id, draft.id)),
      ).resolves.toEqual([
        expect.objectContaining({
          sendClaimId: null,
          sendStatus: "draft",
          subject: "Original subject changed",
        }),
      ]);
    } finally {
      await database.pool.query(`
        DROP TRIGGER IF EXISTS change_claimed_mail_draft_for_test ON mail_drafts;
        DROP FUNCTION IF EXISTS change_claimed_mail_draft_for_test();
      `);
    }
  });

  it.each([
    "failed",
    "lost",
  ] as const)("reports a %s draft-claim release after post-claim validation", async (mode) => {
    await expectDraftClaimReleaseInterference(mode);
  });

  it("releases only proven provider rejections and reconciles ambiguous or stale claims", async () => {
    const rejectedDraft = await service.createDraft(userId, {
      accountId: enabledAccountId,
      body: "Rejected body",
      cc: [],
      subject: "Rejected send",
      to: [{ address: "to@example.com", name: null }],
    });
    const rejectedInput = {
      accountId: enabledAccountId,
      body: rejectedDraft.body,
      cc: rejectedDraft.cc,
      draftId: rejectedDraft.id,
      subject: rejectedDraft.subject,
      to: rejectedDraft.to,
    };
    gateway.send.mockClear();
    gateway.send.mockRejectedValueOnce(
      new MailProviderRejectedError("Provider rejected", new Error("HTTP 400")),
    );
    await expect(
      service.send(userId, rejectedInput, mutationContext("known-provider-rejection")),
    ).rejects.toMatchObject({
      code: "service_unavailable",
      details: {
        draftId: rejectedDraft.id,
        partialEffect: false,
        providerAcceptance: "rejected",
        retrySafe: true,
      },
    });
    await expect(
      database.db.select().from(mailDrafts).where(eq(mailDrafts.id, rejectedDraft.id)),
    ).resolves.toEqual([
      expect.objectContaining({ sendClaimedAt: null, sendStatus: "draft", sentAt: null }),
    ]);

    const ambiguousDraft = await service.createDraft(userId, {
      accountId: enabledAccountId,
      body: "Ambiguous body",
      cc: [],
      subject: "Ambiguous send",
      to: [{ address: "to@example.com", name: null }],
    });
    const ambiguousInput = {
      accountId: enabledAccountId,
      body: ambiguousDraft.body,
      cc: ambiguousDraft.cc,
      draftId: ambiguousDraft.id,
      subject: ambiguousDraft.subject,
      to: ambiguousDraft.to,
    };
    gateway.send.mockRejectedValueOnce(new Error("connection closed after request write"));
    await expect(
      service.send(userId, ambiguousInput, mutationContext("ambiguous-provider-send")),
    ).rejects.toMatchObject({
      code: "service_unavailable",
      details: expect.objectContaining({
        partialEffect: true,
        repairAction: "verify_sent_mail_then_reconcile_draft",
      }),
    });
    await expect(
      service.send(userId, ambiguousInput, mutationContext("ambiguous-provider-retry")),
    ).rejects.toMatchObject({ code: "conflict" });
    expect(gateway.send).toHaveBeenCalledTimes(2);
    await service.reconcileDraft(
      userId,
      ambiguousDraft.id,
      "not_sent",
      mutationContext("ambiguous-draft-reconciled"),
    );
    gateway.send.mockResolvedValueOnce(undefined);
    await expect(
      service.send(userId, ambiguousInput, mutationContext("reconciled-provider-retry")),
    ).resolves.toBeUndefined();
    expect(gateway.send).toHaveBeenCalledTimes(3);

    const staleDraft = await service.createDraft(userId, {
      accountId: enabledAccountId,
      body: "Stale body",
      cc: [],
      subject: "Stale send",
      to: [{ address: "to@example.com", name: null }],
    });
    await database.db
      .update(mailDrafts)
      .set({
        sendClaimedAt: new Date("2026-07-16T11:55:00.000Z"),
        sendClaimId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        sendStatus: "sending",
      })
      .where(eq(mailDrafts.id, staleDraft.id));
    await expect(service.listDrafts(userId)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: staleDraft.id,
          reconciliationState: "sent_mail_review_required",
        }),
      ]),
    );
    const callsBeforeStale = gateway.send.mock.calls.length;
    await expect(
      service.send(
        userId,
        {
          accountId: enabledAccountId,
          body: staleDraft.body,
          cc: staleDraft.cc,
          draftId: staleDraft.id,
          subject: staleDraft.subject,
          to: staleDraft.to,
        },
        mutationContext("stale-draft-send"),
      ),
    ).rejects.toMatchObject({
      code: "conflict",
      details: expect.objectContaining({
        reason: "stale_claim",
        repairAction: "verify_sent_mail_then_reconcile_draft",
      }),
    });
    expect(gateway.send).toHaveBeenCalledTimes(callsBeforeStale);
    await expect(
      database.db.select().from(mailDrafts).where(eq(mailDrafts.id, staleDraft.id)),
    ).resolves.toEqual([expect.objectContaining({ sendStatus: "reconcile" })]);
  });

  it("does not let an expired send owner overwrite a newer draft claim", async () => {
    const clock = new Date("2026-07-16T12:00:00.000Z");
    let rejectOldProvider: ((error: Error) => void) | undefined;
    let resolveNewProvider: (() => void) | undefined;
    let acceptedCount = 0;
    const racingGateway: ConnectedMailGateway = {
      send: vi
        .fn<ConnectedMailGateway["send"]>()
        .mockImplementationOnce(
          () =>
            new Promise<void>((_resolve, reject) => {
              rejectOldProvider = reject;
            }),
        )
        .mockImplementationOnce(
          () =>
            new Promise<void>((resolve) => {
              resolveNewProvider = () => {
                acceptedCount += 1;
                resolve();
              };
            }),
        ),
      update: gateway.update,
    };
    const racingService = createMailService({
      db: database.db,
      gateway: racingGateway,
      now: () => clock,
      reviewSigningKey: "mail-review-signing-key-for-race-tests",
    });
    const draft = await racingService.createDraft(userId, {
      accountId: enabledAccountId,
      body: "Ownership body",
      cc: [],
      subject: "Ownership race",
      to: [{ address: "to@example.com", name: null }],
    });
    const input = {
      accountId: enabledAccountId,
      body: draft.body,
      cc: draft.cc,
      draftId: draft.id,
      subject: draft.subject,
      to: draft.to,
    };
    const oldSend = racingService.send(userId, input, mutationContext("old-draft-owner"));
    await vi.waitFor(() => expect(racingGateway.send).toHaveBeenCalledTimes(1));
    await database.db
      .update(mailDrafts)
      .set({ sendClaimedAt: new Date("2026-07-16T11:55:00.000Z") })
      .where(eq(mailDrafts.id, draft.id));
    await expect(
      racingService.send(userId, input, mutationContext("expire-old-draft-owner")),
    ).rejects.toMatchObject({
      details: expect.objectContaining({ reason: "stale_claim" }),
    });
    await racingService.reconcileDraft(
      userId,
      draft.id,
      "not_sent",
      mutationContext("reconcile-old-draft-owner"),
    );
    const newSend = racingService.send(userId, input, mutationContext("new-draft-owner"));
    await vi.waitFor(() => expect(racingGateway.send).toHaveBeenCalledTimes(2));
    rejectOldProvider?.(
      new MailProviderRejectedError("Old provider request rejected", new Error("HTTP 400")),
    );
    await expect(oldSend).rejects.toMatchObject({
      code: "conflict",
      details: expect.objectContaining({
        claimOwnershipLost: true,
        partialEffect: false,
      }),
    });
    await expect(
      database.db.select().from(mailDrafts).where(eq(mailDrafts.id, draft.id)),
    ).resolves.toEqual([
      expect.objectContaining({
        sendClaimedAt: clock,
        sendStatus: "sending",
        sentAt: null,
      }),
    ]);
    resolveNewProvider?.();
    await expect(newSend).resolves.toBeUndefined();
    expect(acceptedCount).toBe(1);
    await expect(
      database.db.select().from(mailDrafts).where(eq(mailDrafts.id, draft.id)),
    ).resolves.toEqual([expect.objectContaining({ sendStatus: "sent" })]);
  });

  it("preserves structured draft recovery when claim state persistence fails", async () => {
    const installFailure = async (transition: "draft" | "reconcile" | "sent") => {
      await database.pool.query(`
        CREATE OR REPLACE FUNCTION fail_mail_draft_transition_for_test() RETURNS trigger AS $$
        BEGIN
          IF OLD.send_status = 'sending' AND NEW.send_status = '${transition}' THEN
            RAISE EXCEPTION 'forced Mail draft ${transition} transition failure';
          END IF;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
        CREATE TRIGGER fail_mail_draft_transition_for_test
        BEFORE UPDATE ON mail_drafts
        FOR EACH ROW EXECUTE FUNCTION fail_mail_draft_transition_for_test();
      `);
    };
    const removeFailure = async () => {
      await database.pool.query(`
        DROP TRIGGER IF EXISTS fail_mail_draft_transition_for_test ON mail_drafts;
        DROP FUNCTION IF EXISTS fail_mail_draft_transition_for_test();
      `);
    };
    const createInput = async (subject: string) => {
      const draft = await service.createDraft(userId, {
        accountId: enabledAccountId,
        body: subject,
        cc: [],
        subject,
        to: [{ address: "to@example.com", name: null }],
      });
      return {
        draft,
        input: {
          accountId: enabledAccountId,
          body: draft.body,
          cc: draft.cc,
          draftId: draft.id,
          subject: draft.subject,
          to: draft.to,
        },
      };
    };

    const ambiguous = await createInput("Ambiguous state persistence");
    await installFailure("reconcile");
    gateway.send.mockRejectedValueOnce(new Error("ambiguous provider transport"));
    await expect(
      service.send(userId, ambiguous.input, mutationContext("ambiguous-state-write-failure")),
    ).rejects.toMatchObject({
      code: "service_unavailable",
      details: expect.objectContaining({
        draftReconciliationStatePersisted: false,
        repairAction: "verify_sent_mail_then_reconcile_draft",
        userActionRequired: true,
      }),
    });
    await removeFailure();

    const rejected = await createInput("Rejected state persistence");
    await installFailure("draft");
    gateway.send.mockRejectedValueOnce(
      new MailProviderRejectedError("Rejected before acceptance", new Error("HTTP 400")),
    );
    await expect(
      service.send(userId, rejected.input, mutationContext("release-state-write-failure")),
    ).rejects.toMatchObject({
      code: "service_unavailable",
      details: expect.objectContaining({
        draftClaimReleasePersisted: false,
        partialEffect: false,
        repairAction: "review_current_draft_state",
        userActionRequired: true,
      }),
    });
    await removeFailure();

    const finalized = await createInput("Final state persistence");
    await database.pool.query(`
      CREATE OR REPLACE FUNCTION fail_mail_draft_transition_for_test() RETURNS trigger AS $$
      BEGIN
        IF OLD.send_status = 'sending' AND NEW.send_status IN ('sent', 'reconcile') THEN
          RAISE EXCEPTION 'forced Mail draft terminal transition failure';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER fail_mail_draft_transition_for_test
      BEFORE UPDATE ON mail_drafts
      FOR EACH ROW EXECUTE FUNCTION fail_mail_draft_transition_for_test();
    `);
    gateway.send.mockResolvedValueOnce(undefined);
    await expect(
      service.send(userId, finalized.input, mutationContext("final-state-write-failure")),
    ).rejects.toMatchObject({
      code: "service_unavailable",
      details: expect.objectContaining({
        draftReconciliationStatePersisted: false,
        partialEffect: true,
        repairAction: "verify_sent_mail_then_reconcile_draft",
        userActionRequired: true,
      }),
    });
    await removeFailure();
  });

  it("reports a possible draftless send when its durable audit finalization fails", async () => {
    gateway.send.mockClear();
    await database.pool.query(`
      CREATE OR REPLACE FUNCTION fail_mail_sent_audit_for_test() RETURNS trigger AS $$
      BEGIN
        IF NEW.action = 'mail.sent' THEN
          RAISE EXCEPTION 'forced mail sent audit failure';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER fail_mail_sent_audit_for_test
      BEFORE INSERT ON audit_events
      FOR EACH ROW EXECUTE FUNCTION fail_mail_sent_audit_for_test();
    `);
    try {
      await expect(
        service.send(
          userId,
          {
            accountId: enabledAccountId,
            body: "Send once",
            cc: [{ address: "copy@example.com", name: null }],
            subject: "Draftless provider partial send",
            to: [{ address: "ada@example.com", name: "Ada" }],
          },
          mutationContext("send-draftless-audit-failure"),
        ),
      ).rejects.toMatchObject({
        code: "service_unavailable",
        details: {
          accountId: enabledAccountId,
          credentialPersistenceMayHaveFailed: false,
          operation: "send",
          partialEffect: true,
          repairAction: "verify_sent_mail_never_retry",
        },
      });
      expect(gateway.send).toHaveBeenCalledOnce();
      await expect(
        database.db
          .select()
          .from(auditEvents)
          .where(eq(auditEvents.requestId, "send-draftless-audit-failure")),
      ).resolves.toEqual([]);
    } finally {
      await database.pool.query(`
        DROP TRIGGER IF EXISTS fail_mail_sent_audit_for_test ON audit_events;
        DROP FUNCTION IF EXISTS fail_mail_sent_audit_for_test();
      `);
    }
  });

  it("rejects missing messages, drafts, and mailbox memberships", async () => {
    const observed = await service.getThread(userId, threadId);
    gateway.update.mockClear();
    await expect(
      service.updateThread(
        userId,
        threadId,
        { expectedUpdatedAt: "2026-01-01T00:00:00.000Z", starred: !observed.starred },
        { actorId: userId, actorType: "user" },
        "stale-thread-update",
      ),
    ).rejects.toMatchObject({ code: "conflict" });
    await expect(
      service.updateThread(
        userId,
        threadId,
        { mailboxIds: [inboxId, inboxId] },
        { actorId: userId, actorType: "user" },
        "duplicate-thread-mailboxes",
      ),
    ).rejects.toMatchObject({ code: "invalid_request" });
    expect(gateway.update).not.toHaveBeenCalled();
    await expect(
      service.send(
        userId,
        {
          accountId: enabledAccountId,
          body: "Body",
          cc: [],
          draftId: disabledAccountId,
          subject: "Subject",
          to: [{ address: "to@example.com", name: null }],
        },
        mutationContext("send-missing-draft"),
      ),
    ).rejects.toMatchObject({ code: "not_found" });
    await expect(
      service.send(
        userId,
        {
          accountId: enabledAccountId,
          body: "Body",
          cc: [],
          subject: "Subject",
          threadId: disabledAccountId,
          to: [{ address: "to@example.com", name: null }],
        },
        mutationContext("send-missing-thread"),
      ),
    ).rejects.toMatchObject({ code: "not_found" });
    await expect(
      service.snoozeThread(userId, disabledAccountId, new Date("2026-07-18T12:00:00.000Z")),
    ).rejects.toMatchObject({ code: "not_found" });
    await expect(
      service.updateThread(
        userId,
        threadId,
        { mailboxIds: [disabledAccountId], starred: true, unread: true },
        { actorId: userId, actorType: "user" },
        "request-2",
      ),
    ).rejects.toMatchObject({ code: "invalid_request" });
    await expect(
      service.updateThread(
        userId,
        disabledAccountId,
        { starred: true },
        { actorId: userId, actorType: "user" },
        "request-3",
      ),
    ).rejects.toMatchObject({ code: "not_found" });
    await expect(
      service.updateThread(
        userId,
        threadId,
        { starred: true, unread: true },
        { actorId: userId, actorType: "user" },
        "request-4",
      ),
    ).resolves.toMatchObject({ starred: true, unread: true });
    await expect(
      service.updateThread(
        userId,
        threadId,
        { unread: false },
        { actorId: userId, actorType: "user" },
        "request-5",
      ),
    ).resolves.toMatchObject({ unread: false });
    await expect(
      service.bulkUpdateThreads(
        {
          items: [{ expectedUpdatedAt: observed.updatedAt, id: disabledAccountId }],
          unread: true,
        },
        mutationContext("bulk-missing-thread"),
      ),
    ).resolves.toMatchObject({
      failedCount: 1,
      failures: [
        {
          error: { code: "not_found", details: null },
          id: disabledAccountId,
        },
      ],
    });
  });

  it("keeps every draft reconciliation state explicit and human-controlled", async () => {
    await expect(
      service.reconcileDraft(
        userId,
        disabledAccountId,
        "not_sent",
        mutationContext("reconcile-missing"),
      ),
    ).rejects.toMatchObject({ code: "not_found" });

    const untouched = await service.createDraft(userId, {
      accountId: enabledAccountId,
      body: "Untouched",
      cc: [],
      subject: "Untouched draft",
      to: [{ address: "to@example.com", name: null }],
    });
    await expect(
      service.reconcileDraft(
        userId,
        untouched.id,
        "not_sent",
        mutationContext("reconcile-untouched"),
      ),
    ).rejects.toMatchObject({ code: "conflict" });

    const inProgress = await service.createDraft(userId, {
      accountId: enabledAccountId,
      body: "In progress",
      cc: [],
      subject: "In-progress draft",
      to: [{ address: "to@example.com", name: null }],
    });
    await database.db
      .update(mailDrafts)
      .set({
        sendClaimedAt: new Date("2026-07-16T11:59:00.000Z"),
        sendClaimId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        sendStatus: "sending",
      })
      .where(eq(mailDrafts.id, inProgress.id));
    await expect(
      service.reconcileDraft(
        userId,
        inProgress.id,
        "not_sent",
        mutationContext("reconcile-in-progress"),
      ),
    ).rejects.toMatchObject({ code: "conflict" });

    const confirmedSent = await service.createDraft(userId, {
      accountId: enabledAccountId,
      body: "Confirmed sent",
      cc: [],
      subject: "Confirmed sent draft",
      to: [{ address: "to@example.com", name: null }],
    });
    await database.db
      .update(mailDrafts)
      .set({
        sendClaimedAt: new Date("2026-07-16T11:55:00.000Z"),
        sendClaimId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        sendStatus: "reconcile",
      })
      .where(eq(mailDrafts.id, confirmedSent.id));
    await expect(
      service.reconcileDraft(
        userId,
        confirmedSent.id,
        "sent",
        mutationContext("reconcile-confirmed-sent"),
      ),
    ).resolves.toMatchObject({ sendStatus: "sent", sentAt: expect.any(Date) });
    await expect(
      service.reconcileDraft(
        userId,
        confirmedSent.id,
        "not_sent",
        mutationContext("reconcile-already-sent"),
      ),
    ).rejects.toMatchObject({ code: "conflict" });
  });

  it("maps multi-inbox setup and serializes source-derived Mail attention", async () => {
    const [sparseICloudAccount] = await database.db
      .insert(calendarAccounts)
      .values({
        calendarEnabled: false,
        email: null,
        label: "iCloud Mail",
        lastSyncedAt: new Date("2026-07-16T10:00:00.000Z"),
        mailEnabled: true,
        provider: "icloud",
        providerAccountId: "icloud-mail-setup",
        userId,
      })
      .returning();
    if (!sparseICloudAccount) throw new Error("Sparse Mail account fixture was not created.");
    const statusSourceUpdatedAt = new Date("2026-07-16T10:30:00.000Z");
    const statusActions = {
      claimed: { afterDays: 1, mailboxId: null, type: "trash" as const },
      failed: { afterDays: 1, mailboxId: customLabelId, type: "add_label" as const },
      pending: { afterDays: 1, mailboxId: null, type: "archive" as const },
      reconcile: { afterDays: 1, mailboxId: null, type: "mark_read" as const },
      succeeded: { afterDays: 1, mailboxId: null, type: "star" as const },
    };
    await database.db.insert(mailRuleWorkItems).values([
      {
        accountId: enabledAccountId,
        action: statusActions.pending,
        actionFingerprint: durableMailRuleActionFingerprint(statusActions.pending),
        dueAt: new Date("2026-07-16T11:00:00.000Z"),
        nextAttemptAt: new Date("2026-07-16T11:00:00.000Z"),
        profileId,
        profileVersion: 1,
        remoteThreadId: "thread-1",
        ruleId: legacyRuleId,
        ruleVersion: 1,
        sourceUpdatedAt: statusSourceUpdatedAt,
        threadId,
        userId,
      },
      {
        accountId: enabledAccountId,
        action: statusActions.claimed,
        actionFingerprint: durableMailRuleActionFingerprint(statusActions.claimed),
        attemptCount: 1,
        claimId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        claimedAt: new Date("2026-07-16T11:30:00.000Z"),
        claimMode: "execute",
        dueAt: new Date("2026-07-16T11:15:00.000Z"),
        nextAttemptAt: new Date("2026-07-16T11:15:00.000Z"),
        profileId,
        profileVersion: 1,
        remoteThreadId: "thread-1",
        ruleId: legacyRuleId,
        ruleVersion: 1,
        sourceUpdatedAt: statusSourceUpdatedAt,
        status: "claimed",
        threadId,
        userId,
      },
      {
        accountId: enabledAccountId,
        action: statusActions.reconcile,
        actionFingerprint: durableMailRuleActionFingerprint(statusActions.reconcile),
        dueAt: new Date("2026-07-16T11:20:00.000Z"),
        nextAttemptAt: new Date("2026-07-16T11:20:00.000Z"),
        profileId,
        profileVersion: 1,
        providerEffect: "indeterminate",
        remoteThreadId: "thread-1",
        ruleId: legacyRuleId,
        ruleVersion: 1,
        sourceUpdatedAt: statusSourceUpdatedAt,
        status: "reconcile",
        threadId,
        userId,
      },
      {
        accountId: enabledAccountId,
        action: statusActions.succeeded,
        actionFingerprint: durableMailRuleActionFingerprint(statusActions.succeeded),
        completedAt: new Date("2026-07-16T12:00:00.000Z"),
        dueAt: new Date("2026-07-16T11:25:00.000Z"),
        nextAttemptAt: new Date("2026-07-16T12:00:00.000Z"),
        profileId,
        profileVersion: 1,
        providerEffect: "applied",
        remoteThreadId: "thread-1",
        ruleId: legacyRuleId,
        ruleVersion: 1,
        sourceUpdatedAt: statusSourceUpdatedAt,
        status: "succeeded",
        threadId,
        userId,
      },
      {
        accountId: enabledAccountId,
        action: statusActions.failed,
        actionFingerprint: durableMailRuleActionFingerprint(statusActions.failed),
        completedAt: new Date("2026-07-16T12:05:00.000Z"),
        dueAt: new Date("2026-07-16T11:30:00.000Z"),
        lastErrorCode: "provider_rejected",
        lastErrorMessage: "The provider rejected this operation.",
        nextAttemptAt: new Date("2026-07-16T12:05:00.000Z"),
        profileId,
        profileVersion: 1,
        providerEffect: "rejected",
        remoteThreadId: "thread-1",
        ruleId: legacyRuleId,
        ruleVersion: 1,
        sourceUpdatedAt: statusSourceUpdatedAt,
        status: "failed",
        threadId,
        userId,
      },
      {
        accountId: disabledAccountId,
        action: statusActions.pending,
        actionFingerprint: durableMailRuleActionFingerprint(statusActions.pending),
        completedAt: new Date("2026-07-16T12:10:00.000Z"),
        dueAt: new Date("2026-07-16T11:35:00.000Z"),
        lastErrorCode: "source_unavailable",
        lastErrorMessage: "The connected Mail source is no longer available.",
        nextAttemptAt: new Date("2026-07-16T12:10:00.000Z"),
        profileId,
        profileVersion: 1,
        providerEffect: "none",
        remoteThreadId: "disabled-thread",
        ruleId: legacyRuleId,
        ruleVersion: 1,
        sourceUpdatedAt: statusSourceUpdatedAt,
        status: "failed",
        threadId: null,
        userId,
      },
    ]);
    await expect(service.listSetupContext(userId)).resolves.toMatchObject({
      accounts: [
        {
          accountId: enabledAccountId,
          automation: {
            failedCount: 1,
            inProgressCount: 1,
            lastCompletedAt: "2026-07-16T12:05:00.000Z",
            pendingCount: 1,
            reconciliationCount: 1,
          },
          automaticRuleExecution: true,
          email: "enabled@example.com",
          label: "Enabled",
          mailboxes: expect.arrayContaining([
            expect.objectContaining({ id: inboxId, role: "inbox" }),
          ]),
          provider: "google",
          syncStatus: "idle",
        },
        {
          accountId: sparseICloudAccount.id,
          automation: {
            failedCount: 0,
            inProgressCount: 0,
            pendingCount: 0,
            reconciliationCount: 0,
          },
          automaticRuleExecution: false,
          lastSyncedAt: "2026-07-16T10:00:00.000Z",
          mailboxes: [],
          provider: "icloud",
        },
      ],
      commitmentIntake: {
        automaticCreationEnabled: false,
        previewOnlyCount: 0,
        serverVerifiedCount: 0,
      },
      automation: {
        executionLimitPerRun: 6,
        failedCount: 1,
        inProgressCount: 1,
        lastCompletedAt: "2026-07-16T12:05:00.000Z",
        oldestDueAt: "2026-07-16T11:00:00.000Z",
        pendingCount: 1,
        reconciliationCount: 1,
      },
      safety: {
        delayedRetentionAutomation: true,
        permanentDeletion: false,
        providerFilterCreation: false,
        spamClassification: false,
        unsubscribeAutomation: false,
      },
    });
    await expect(
      service.validateProfileSources(database.db, userId, [enabledAccountId]),
    ).resolves.toBeUndefined();
    await expect(
      service.validateProfileSources(database.db, userId, [disabledAccountId]),
    ).rejects.toMatchObject({ code: "invalid_request" });
    await database.db
      .delete(calendarAccounts)
      .where(eq(calendarAccounts.id, sparseICloudAccount.id));

    const context = {
      principal: {
        actorId: userId,
        actorType: "agent" as const,
        scopes: new Set(["mail:read" as const, "mail:write" as const]),
        userId,
      },
      requestId: "mail-attention",
    };
    const input = {
      expiresAt: null,
      importance: "high" as const,
      kind: "important" as const,
      occursAt: null,
      summary: "Ada needs a reply.",
      title: "Reply to Ada",
    };
    const observedThread = await service.getThread(userId, threadId);
    const [first, second] = await Promise.all([
      service.upsertAttentionItem(threadId, input, context),
      service.upsertAttentionItem(threadId, input, { ...context, requestId: "mail-attention-2" }),
    ]);
    expect(second.id).toBe(first.id);
    expect(first).toMatchObject({
      domain: "mail",
      relatedEntityId: threadId,
      relatedEntityType: "mail_thread",
      source: {
        accountId: enabledAccountId,
        provider: "google",
        remoteId: "thread-1",
        revision: observedThread.updatedAt,
        sourceType: "mail_thread",
      },
      status: "open",
    });
    const refreshedRevision = new Date(new Date(observedThread.updatedAt).getTime() + 1_000);
    await database.db
      .update(mailThreads)
      .set({ updatedAt: refreshedRevision })
      .where(eq(mailThreads.id, threadId));
    const refreshed = await service.upsertAttentionItem(
      threadId,
      {
        ...input,
        expiresAt: "2026-07-30T12:00:00.000Z",
        occursAt: "2026-07-29T12:00:00.000Z",
      },
      {
        ...context,
        requestId: "mail-attention-refresh",
      },
    );
    expect(refreshed).toMatchObject({
      expiresAt: "2026-07-30T12:00:00.000Z",
      id: first.id,
      occursAt: "2026-07-29T12:00:00.000Z",
      source: { revision: refreshedRevision.toISOString() },
    });
    await expect(
      service.upsertAttentionItem(disabledAccountId, input, {
        ...context,
        requestId: "mail-attention-missing",
      }),
    ).rejects.toMatchObject({ code: "not_found" });
    await expect(database.db.select().from(attentionItems)).resolves.toEqual([
      expect.objectContaining({ id: first.id }),
    ]);
    const attentionAudits = await database.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.entityId, first.id));
    expect(attentionAudits).toHaveLength(3);
    expect(attentionAudits.map((event) => event.after)).toEqual([
      {
        domain: "mail",
        importance: "high",
        kind: "important",
        relatedEntityType: "mail_thread",
        status: "open",
      },
      {
        domain: "mail",
        importance: "high",
        kind: "important",
        relatedEntityType: "mail_thread",
        status: "open",
      },
      {
        domain: "mail",
        importance: "high",
        kind: "important",
        relatedEntityType: "mail_thread",
        status: "open",
      },
    ]);
    const attentionAuditJson = JSON.stringify(attentionAudits);
    expect(attentionAuditJson).not.toContain("Reply to Ada");
    expect(attentionAuditJson).not.toContain("Ada needs a reply.");
    expect(attentionAuditJson).not.toContain("thread-1");
    expect(attentionAuditJson).not.toContain(enabledAccountId);
  });

  it("owns bounded batch partial effects and correlation in the Mail API", async () => {
    gateway.update.mockImplementation(async (_userId, _accountId, remoteThreadId) => {
      if (remoteThreadId === "thread-2") throw new Error("Provider unavailable");
    });
    const context = {
      principal: {
        actorId: userId,
        actorType: "agent" as const,
        scopes: new Set(["mail:read" as const, "mail:write" as const]),
        userId,
      },
      requestId: "bulk-partial",
    };
    try {
      await expect(
        service.bulkUpdateThreads(
          {
            items: [
              {
                expectedUpdatedAt: (await service.getThread(userId, threadId)).updatedAt,
                id: threadId,
              },
              {
                expectedUpdatedAt: (await service.getThread(userId, secondThreadId)).updatedAt,
                id: secondThreadId,
              },
            ],
            unread: true,
          },
          context,
        ),
      ).resolves.toEqual({
        failedCount: 1,
        failures: [
          {
            error: {
              code: "service_unavailable",
              details: null,
              message: "The provider Mail update failed.",
              status: 503,
            },
            id: secondThreadId,
          },
        ],
        updatedCount: 1,
        updatedIds: [threadId],
      });
      const correlated = await database.db
        .select()
        .from(auditEvents)
        .where(eq(auditEvents.requestId, "bulk-partial"));
      expect(correlated).toEqual([
        expect.objectContaining({
          action: "mail.thread.updated",
          entityId: threadId,
          entityType: "mail_thread",
        }),
      ]);
    } finally {
      gateway.update.mockReset();
      gateway.update.mockResolvedValue(undefined);
    }
  });

  it("reports a repair action when provider success precedes local rollback", async () => {
    await database.pool.query(`
      CREATE OR REPLACE FUNCTION fail_mail_audit_for_test() RETURNS trigger AS $$
      BEGIN
        IF NEW.request_id = 'bulk-local-failure' THEN
          RAISE EXCEPTION 'forced audit failure';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER fail_mail_audit_for_test
      BEFORE INSERT ON audit_events
      FOR EACH ROW EXECUTE FUNCTION fail_mail_audit_for_test();
    `);
    const [before] = await database.db
      .select()
      .from(mailThreads)
      .where(eq(mailThreads.id, threadId));
    if (!before) throw new Error("Thread fixture disappeared.");
    try {
      const app = new Hono<AppEnv>();
      app.use("*", async (context, next) => {
        context.set("principal", {
          actorId: userId,
          actorType: "agent",
          scopes: new Set(["mail:read", "mail:write"]),
          userId,
        });
        context.set("requestId", "bulk-local-failure");
        await next();
      });
      app.onError(errorResponse);
      registerMailRoutes({
        app,
        mail: service,
        mutationContext: (context) => ({
          principal: context.get("principal"),
          requestId: context.get("requestId"),
        }),
      });
      const response = await app.request("/v1/mail/threads/bulk", {
        body: JSON.stringify({
          items: [{ expectedUpdatedAt: before.updatedAt.toISOString(), id: threadId }],
          starred: !before.starred,
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      expect(response.status).toBe(200);
      const { result } = (await response.json()) as {
        result: Awaited<ReturnType<typeof service.bulkUpdateThreads>>;
      };
      expect(result).toMatchObject({
        failedCount: 1,
        failures: [
          {
            error: {
              code: "service_unavailable",
              details: {
                accountId: enabledAccountId,
                partialEffect: true,
                repairAction: "sync_mail_account",
                threadId,
              },
              status: 503,
            },
            id: threadId,
          },
        ],
        updatedCount: 0,
      });
      const [after] = await database.db
        .select()
        .from(mailThreads)
        .where(eq(mailThreads.id, threadId));
      expect(after?.starred).toBe(before.starred);
      expect(gateway.update).toHaveBeenCalledWith(
        userId,
        enabledAccountId,
        "thread-1",
        expect.any(Object),
      );
      await expect(
        database.db
          .select()
          .from(auditEvents)
          .where(eq(auditEvents.requestId, "bulk-local-failure")),
      ).resolves.toEqual([]);
    } finally {
      await database.pool.query(`
        DROP TRIGGER IF EXISTS fail_mail_audit_for_test ON audit_events;
        DROP FUNCTION IF EXISTS fail_mail_audit_for_test();
      `);
    }
  });

  it("uses thread revisions to detect opposing provider-backed updates", async () => {
    const observed = await service.getThread(userId, threadId);
    let arrivals = 0;
    const releaseUpdates: Array<() => void> = [];
    const bothProviderCallsArrived = new Promise<void>((resolve) => {
      gateway.update.mockImplementation(async () => {
        arrivals += 1;
        if (arrivals === 2) resolve();
        await new Promise<void>((release) => {
          releaseUpdates.push(release);
        });
      });
    });
    const first = service.updateThread(
      userId,
      threadId,
      { expectedUpdatedAt: observed.updatedAt, starred: true },
      { actorId: userId, actorType: "agent" },
      "revision-first",
    );
    const second = service.updateThread(
      userId,
      threadId,
      { expectedUpdatedAt: observed.updatedAt, starred: false },
      { actorId: userId, actorType: "agent" },
      "revision-second",
    );
    await bothProviderCallsArrived;
    for (const release of releaseUpdates) release();
    const outcomes = await Promise.allSettled([first, second]);
    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === "rejected")).toEqual([
      expect.objectContaining({
        reason: expect.objectContaining({
          code: "service_unavailable",
          details: expect.objectContaining({
            partialEffect: true,
            repairAction: "sync_mail_account",
          }),
        }),
      }),
    ]);
    gateway.update.mockReset();
    gateway.update.mockResolvedValue(undefined);
  });

  it("rejects cross-account Mail references and replayed or mismatched drafts", async () => {
    const [otherAccount] = await database.db
      .insert(calendarAccounts)
      .values({
        calendarEnabled: false,
        email: "other@example.com",
        label: "Other Mail",
        mailEnabled: true,
        provider: "google",
        providerAccountId: "other-mail",
        userId,
      })
      .returning();
    if (!otherAccount) throw new Error("Other Mail account fixture was not created.");
    const [otherMailbox] = await database.db
      .insert(mailboxes)
      .values({
        accountId: otherAccount.id,
        name: "Other label",
        provider: "google",
        remoteMailboxId: "Label_Other",
        role: "custom",
        userId,
      })
      .returning();
    if (!otherMailbox) throw new Error("Other mailbox fixture was not created.");

    gateway.update.mockClear();
    await expect(
      service.updateThread(
        userId,
        threadId,
        { mailboxIds: [otherMailbox.id] },
        { actorId: userId, actorType: "user" },
        "cross-account-mailbox",
      ),
    ).rejects.toThrow("do not belong");
    expect(gateway.update).not.toHaveBeenCalled();
    await expect(
      service.createDraft(userId, {
        accountId: disabledAccountId,
        body: "Disabled",
        cc: [],
        subject: "Disabled",
        to: [{ address: "to@example.com", name: null }],
      }),
    ).rejects.toThrow("Mail enabled");
    const [otherUser] = await database.db
      .insert(users)
      .values({
        displayName: "Other User",
        email: "other-user@example.com",
        passwordHash: "unused",
        planningTimezone: "UTC",
      })
      .returning();
    if (!otherUser) throw new Error("Other user fixture was not created.");
    const [foreignAccount] = await database.db
      .insert(calendarAccounts)
      .values({
        calendarEnabled: false,
        email: "foreign@example.com",
        label: "Foreign Mail",
        mailEnabled: true,
        provider: "google",
        providerAccountId: "foreign-mail",
        userId: otherUser.id,
      })
      .returning();
    if (!foreignAccount) throw new Error("Foreign account fixture was not created.");
    await expect(
      service.createDraft(userId, {
        accountId: foreignAccount.id,
        body: "Foreign",
        cc: [],
        subject: "Foreign",
        to: [{ address: "to@example.com", name: null }],
      }),
    ).rejects.toThrow("owned connected account");
    await expect(
      service.createDraft(userId, {
        accountId: otherAccount.id,
        body: "Cross account",
        cc: [],
        subject: "Cross account",
        threadId,
        to: [{ address: "to@example.com", name: null }],
      }),
    ).rejects.toThrow("must belong");
    await expect(
      service.send(
        userId,
        {
          accountId: otherAccount.id,
          body: "Cross account",
          cc: [],
          subject: "Cross account",
          threadId,
          to: [{ address: "to@example.com", name: null }],
        },
        mutationContext("cross-account-send"),
      ),
    ).rejects.toMatchObject({ code: "not_found" });

    const draft = await service.createDraft(userId, {
      accountId: enabledAccountId,
      body: "Exact body",
      cc: [],
      subject: "Exact subject",
      to: [{ address: "to@example.com", name: null }],
    });
    gateway.send.mockClear();
    await expect(
      service.send(
        userId,
        {
          accountId: enabledAccountId,
          body: "Exact body",
          cc: [],
          draftId: draft.id,
          subject: "Changed subject",
          to: [{ address: "to@example.com", name: null }],
        },
        mutationContext("draft-mismatch"),
      ),
    ).rejects.toThrow("exact saved");
    expect(gateway.send).not.toHaveBeenCalled();
    const exactSend = {
      accountId: enabledAccountId,
      body: "Exact body",
      cc: [],
      draftId: draft.id,
      subject: "Exact subject",
      to: [{ address: "to@example.com", name: null }],
    };
    await service.send(userId, exactSend, mutationContext("draft-exact"));
    await expect(service.send(userId, exactSend, mutationContext("draft-replay"))).rejects.toThrow(
      "already sent",
    );
    expect(gateway.send).toHaveBeenCalledTimes(1);
  });

  it("validates rule references and preserves explicit partial updates", async () => {
    const context = {
      principal: {
        actorId: userId,
        actorType: "user" as const,
        scopes: new Set(["mail:read" as const, "mail:write" as const]),
        userId,
      },
      requestId: "rule-validation",
    };
    const baseRule = {
      actions: [{ afterDays: 0, mailboxId: null, type: "mark_read" as const }],
      condition: {
        field: "sender" as const,
        operator: "ends_with" as const,
        value: "@example.com",
      },
      confidenceThreshold: null,
      description: "Read known senders.",
      enabled: false as const,
      name: "Known senders",
      policy: "preview" as const,
      profileId,
      sourceIds: [enabledAccountId],
    };
    await expect(
      service.createRule({ ...baseRule, profileId: disabledAccountId }, context),
    ).rejects.toMatchObject({ code: "not_found" });
    await expect(
      service.createRule({ ...baseRule, sourceIds: [disabledAccountId] }, context),
    ).rejects.toMatchObject({ code: "invalid_request" });
    await expect(
      service.createRule(
        {
          ...baseRule,
          actions: [{ afterDays: 0, mailboxId: disabledAccountId, type: "add_label" }],
        },
        context,
      ),
    ).rejects.toMatchObject({ code: "invalid_request" });
    await expect(
      service.createRule(
        {
          ...baseRule,
          actions: [{ afterDays: 0, mailboxId: inboxId, type: "add_label" }],
          sourceIds: [],
        },
        context,
      ),
    ).rejects.toMatchObject({ code: "invalid_request" });
    await expect(
      service.createRule(
        {
          ...baseRule,
          actions: [{ afterDays: 0, mailboxId: inboxId, type: "add_label" }],
        },
        context,
      ),
    ).rejects.toThrow("ordinary user label");
    const [foreignLabel] = await database.db
      .select()
      .from(mailboxes)
      .where(eq(mailboxes.remoteMailboxId, "Label_Other"));
    if (!foreignLabel) throw new Error("Foreign label fixture is missing.");
    await expect(
      service.createRule(
        {
          ...baseRule,
          actions: [{ afterDays: 0, mailboxId: foreignLabel.id, type: "add_label" }],
        },
        context,
      ),
    ).rejects.toThrow("owns the label");

    const rule = await service.createRule(
      {
        ...baseRule,
        actions: [{ afterDays: 0, mailboxId: customLabelId, type: "add_label" }],
      },
      context,
    );
    expect(rule).toMatchObject({
      confidenceThreshold: null,
      profileId,
      sourceIds: [enabledAccountId],
    });
    await expect(
      service.previewRule(userId, {
        actions: baseRule.actions,
        condition: baseRule.condition,
        confidenceThreshold: null,
        description: baseRule.description,
        sourceIds: [],
      }),
    ).resolves.toMatchObject({ matchedCount: 2, scannedCount: 2 });
    await expect(
      service.updateRule(disabledAccountId, { enabled: false, expectedVersion: 1 }, context),
    ).rejects.toMatchObject({ code: "not_found" });
    await expect(
      service.updateRule(rule.id, { expectedVersion: 99, name: "Stale rule name" }, context),
    ).rejects.toMatchObject({ code: "conflict" });
    await expect(
      service.updateRule(
        rule.id,
        { expectedVersion: rule.version, policy: "approved_rule" },
        context,
      ),
    ).rejects.toMatchObject({ code: "invalid_request" });
    await expect(
      service.updateRule(rule.id, { enabled: true, expectedVersion: rule.version }, context),
    ).rejects.toMatchObject({ code: "invalid_request" });
    await database.db
      .update(domainProfiles)
      .set({ status: "draft" })
      .where(eq(domainProfiles.id, profileId));
    const draftProfilePreview = await service.previewSavedRule(userId, rule.id);
    await expect(
      service.activateRule(
        rule.id,
        {
          expectedCandidateIds: draftProfilePreview.candidates.map((candidate) => candidate.id),
          expectedPreviewFingerprint: draftProfilePreview.fingerprint,
          expectedPreviewedAt: draftProfilePreview.previewedAt,
          expectedVersion: rule.version,
        },
        context,
      ),
    ).rejects.toMatchObject({ code: "invalid_request" });
    await expect(
      service.updateRule(
        rule.id,
        {
          actions: baseRule.actions,
          confidenceThreshold: null,
          expectedVersion: rule.version,
          profileId: null,
          sourceIds: [],
        },
        context,
      ),
    ).resolves.toMatchObject({
      confidenceThreshold: null,
      profileId: null,
      sourceIds: [],
      version: 2,
    });
    await expect(
      service.activateRule(
        rule.id,
        {
          expectedCandidateIds: [],
          expectedPreviewFingerprint: "a".repeat(64),
          expectedPreviewedAt: "2026-07-16T12:00:00.000Z",
          expectedVersion: 1,
        },
        context,
      ),
    ).rejects.toMatchObject({
      code: "conflict",
      details: expect.objectContaining({ currentVersion: 2 }),
    });
  });

  it("fails closed across Mail rule activation safety boundaries", async () => {
    const context = mutationContext("rule-safety-matrix");
    const activationInputFor = async (rule: Awaited<ReturnType<typeof service.createRule>>) => {
      const preview = await service.previewSavedRule(userId, rule.id);
      return {
        expectedCandidateIds: preview.candidates.map((candidate) => candidate.id),
        expectedPreviewFingerprint: preview.fingerprint,
        expectedPreviewedAt: preview.previewedAt,
        expectedVersion: rule.version,
      };
    };
    const baseRule = {
      actions: [{ afterDays: 0, mailboxId: null, type: "mark_read" as const }],
      condition: {
        field: "sender" as const,
        operator: "ends_with" as const,
        value: "@example.com",
      },
      confidenceThreshold: null,
      description: "Safety boundary fixture.",
      enabled: false as const,
      policy: "preview" as const,
    };
    const missingActivation = {
      expectedCandidateIds: [],
      expectedPreviewFingerprint: "a".repeat(64),
      expectedPreviewedAt: "2026-07-16T12:00:00.000Z",
      expectedVersion: 1,
    };
    await expect(service.previewSavedRule(userId, disabledAccountId)).rejects.toMatchObject({
      code: "not_found",
    });
    await expect(
      service.activateRule(disabledAccountId, missingActivation, context),
    ).rejects.toMatchObject({ code: "not_found" });

    const activeRule = (await service.listRules(userId)).find(
      (rule) => rule.enabled && rule.policy === "approved_rule",
    );
    if (!activeRule) throw new Error("Active Mail rule fixture is missing.");
    await expect(
      service.activateRule(
        activeRule.id,
        { ...missingActivation, expectedVersion: activeRule.version },
        context,
      ),
    ).rejects.toThrow("already active");

    const noProfile = await service.createRule(
      {
        ...baseRule,
        name: "Missing profile",
        profileId: null,
        sourceIds: [enabledAccountId],
      },
      context,
    );
    await expect(
      service.activateRule(noProfile.id, await activationInputFor(noProfile), context),
    ).rejects.toThrow("Link an active Mail profile");

    const duplicateSources = await service.createRule(
      {
        ...baseRule,
        name: "Duplicate sources",
        profileId,
        sourceIds: [enabledAccountId, enabledAccountId],
      },
      context,
    );
    await expect(
      service.activateRule(
        duplicateSources.id,
        await activationInputFor(duplicateSources),
        context,
      ),
    ).rejects.toThrow("explicit Mail account sources");

    await database.db
      .update(domainProfiles)
      .set({
        preferences: {
          importantEmailHandling: "inbox_only",
          inboxStyle: "conservative",
          noiseDisposition: "archive_after_days",
        },
        sourceContexts: [
          {
            notes: null,
            purpose: "Primary inbox",
            sourceId: enabledAccountId,
            sourceLabel: "Enabled",
          },
        ],
        status: "active",
      })
      .where(eq(domainProfiles.id, profileId));
    const invalidPreferencesRule = await service.createRule(
      {
        ...baseRule,
        name: "Invalid preferences",
        profileId,
        sourceIds: [enabledAccountId],
      },
      context,
    );
    await expect(
      service.activateRule(
        invalidPreferencesRule.id,
        await activationInputFor(invalidPreferencesRule),
        context,
      ),
    ).rejects.toThrow("valid Mail retention preferences");

    const [icloudAccount] = await database.db
      .insert(calendarAccounts)
      .values({
        calendarEnabled: false,
        email: "icloud@example.com",
        label: "iCloud",
        mailEnabled: true,
        provider: "icloud",
        providerAccountId: "icloud-rule-safety",
        userId,
      })
      .returning();
    if (!icloudAccount) throw new Error("iCloud rule source fixture was not created.");
    await database.db
      .update(domainProfiles)
      .set({
        preferences: {
          importantEmailHandling: "inbox_only",
          inboxStyle: "conservative",
          noiseDisposition: "review_only",
        },
        sourceContexts: [
          {
            notes: null,
            purpose: "Primary inbox",
            sourceId: enabledAccountId,
            sourceLabel: "Enabled",
          },
          {
            notes: null,
            purpose: "iCloud inbox",
            sourceId: icloudAccount.id,
            sourceLabel: "iCloud",
          },
        ],
        status: "active",
      })
      .where(eq(domainProfiles.id, profileId));
    const icloudRule = await service.createRule(
      {
        ...baseRule,
        name: "Unsupported automatic source",
        profileId,
        sourceIds: [icloudAccount.id],
      },
      context,
    );
    await expect(
      service.activateRule(icloudRule.id, await activationInputFor(icloudRule), context),
    ).rejects.toThrow("require explicit Google Mail sources");

    const retentionRule = await service.createRule(
      {
        ...baseRule,
        actions: [{ afterDays: 0, mailboxId: null, type: "archive" }],
        name: "Immediate archive uses durable work",
        profileId,
        sourceIds: [enabledAccountId],
      },
      context,
    );
    await expect(
      service.activateRule(retentionRule.id, await activationInputFor(retentionRule), context),
    ).resolves.toMatchObject({
      rule: { enabled: true, policy: "approved_rule", version: 2 },
    });
    await expect(
      database.db
        .select()
        .from(mailRuleWorkItems)
        .where(eq(mailRuleWorkItems.ruleId, retentionRule.id)),
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: { afterDays: 0, mailboxId: null, type: "archive" },
          profileId,
          profileVersion: expect.any(Number),
          ruleVersion: 2,
          status: "pending",
          threadId,
        }),
      ]),
    );

    const labelRule = await service.createRule(
      {
        ...baseRule,
        actions: [{ afterDays: 0, mailboxId: customLabelId, type: "add_label" }],
        name: "Apply project label",
        profileId,
        sourceIds: [enabledAccountId],
      },
      context,
    );
    await expect(
      service.activateRule(labelRule.id, await activationInputFor(labelRule), context),
    ).resolves.toMatchObject({
      rule: { enabled: true, policy: "approved_rule", version: 2 },
    });
  });

  it("rejects activation when a locked candidate changes after review", async () => {
    await database.db
      .update(domainProfiles)
      .set({
        preferences: {
          importantEmailHandling: "inbox_only",
          inboxStyle: "conservative",
          noiseDisposition: "review_only",
        },
        sourceContexts: [
          {
            notes: null,
            purpose: "Primary inbox",
            sourceId: enabledAccountId,
            sourceLabel: "Enabled",
          },
        ],
        status: "active",
      })
      .where(eq(domainProfiles.id, profileId));
    const context = mutationContext("candidate-drift-create");
    const rule = await service.createRule(
      {
        actions: [{ afterDays: 0, mailboxId: null, type: "mark_read" }],
        condition: { field: "sender", operator: "ends_with", value: "@example.com" },
        confidenceThreshold: null,
        description: "Mark example senders read.",
        enabled: false,
        name: "Candidate drift rule",
        policy: "preview",
        profileId,
        sourceIds: [enabledAccountId],
      },
      context,
    );
    const reviewed = await service.previewSavedRule(userId, rule.id);
    const updater = await database.pool.connect();
    let committed = false;
    try {
      await updater.query("BEGIN");
      await updater.query(
        `UPDATE mail_threads
         SET subject = 'Changed but still matching', updated_at = updated_at + interval '1 second'
         WHERE id = $1`,
        [threadId],
      );
      const activation = service.activateRule(
        rule.id,
        {
          expectedCandidateIds: reviewed.candidates.map((candidate) => candidate.id),
          expectedPreviewFingerprint: reviewed.fingerprint,
          expectedPreviewedAt: reviewed.previewedAt,
          expectedVersion: rule.version,
        },
        mutationContext("candidate-drift-activate"),
      );
      await new Promise<void>((resolveTurn) => {
        setImmediate(resolveTurn);
      });
      await updater.query("COMMIT");
      committed = true;
      await expect(activation).rejects.toThrow("exact Mail rule preview changed");
    } finally {
      if (!committed) await updater.query("ROLLBACK");
      updater.release();
    }
    const [stored] = await database.db.select().from(mailRules).where(eq(mailRules.id, rule.id));
    expect(stored).toMatchObject({ enabled: false, policy: "preview", version: rule.version });
  });

  it("reports preview truncation only when more than 200 conversations exist", async () => {
    await database.db.insert(mailThreads).values(
      Array.from({ length: 198 }, (_, index) => ({
        accountId: enabledAccountId,
        bodyText: "Preview body",
        from: { address: `preview-${index}@example.com`, name: null },
        provider: "google" as const,
        receivedAt: new Date(`2026-07-14T${String(index % 24).padStart(2, "0")}:00:00.000Z`),
        remoteMailboxIds: ["INBOX"],
        remoteThreadId: `preview-${index}`,
        snippet: "Preview",
        subject: "Preview",
        to: [],
        unread: false,
        userId,
      })),
    );
    const input = {
      actions: [{ afterDays: 0, mailboxId: null, type: "mark_read" as const }],
      condition: {
        field: "sender" as const,
        operator: "ends_with" as const,
        value: "@example.com",
      },
      confidenceThreshold: null,
      description: "Preview bounded window.",
      sourceIds: [enabledAccountId],
    };
    await expect(service.previewRule(userId, input)).resolves.toMatchObject({
      scannedCount: 200,
      window: { limit: 200, truncated: false },
    });
    await database.db.insert(mailThreads).values({
      accountId: enabledAccountId,
      bodyText: "One more",
      from: { address: "one-more@example.com", name: null },
      provider: "google",
      receivedAt: new Date("2026-07-16T11:00:00.000Z"),
      remoteMailboxIds: ["INBOX"],
      remoteThreadId: "preview-overflow",
      snippet: "One more",
      subject: "One more",
      to: [],
      unread: false,
      userId,
    });
    await expect(service.previewRule(userId, input)).resolves.toMatchObject({
      scannedCount: 200,
      window: { limit: 200, truncated: true },
    });
  });
});
