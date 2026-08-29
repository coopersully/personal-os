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
  mailCalendarCommitmentIntakes,
  mailDrafts,
  mailMessages,
  mailRules,
  mailRuleWorkItems,
  mailThreads,
  migrateDatabase,
  users,
} from "@personal-os/database";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
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
    send: vi.fn(async () => undefined),
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
      "0049_attention_item_versions",
      "0050_connector_sync_health",
      "0051_connector_authorization_attempts",
      "0052_connector_notifications",
      "0053_oauth_states_expiry_index",
      "0054_agent_access_work_item_snapshots",
      "0055_finance_sync_health",
      "0056_workspace_maintenance_runs",
      "0057_finance_currency_evidence",
      "0058_finance_provider_items",
      "0059_finance_automation_settings",
      "0060_finance_agent_action_reviews",
      "0061_finance_transaction_allocations",
      "0062_finance_reimbursements",
      "0063_finance_maintenance_candidates",
      "0064_finance_ledger_challenges",
      "0065_finance_period_reviews",
      "0066_finance_plan_versions",
      "0067_finance_ledger_protocol",
      "0068_finance_mutation_leases",
      "0069_finance_legacy_budget_backfill",
      "0070_calendar_stewardship_foundations",
      "0071_calendar_event_links",
      "0072_mail_workspace_stewardship",
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
      "0049_attention_item_versions",
      "0050_connector_sync_health",
      "0051_connector_authorization_attempts",
      "0052_connector_notifications",
      "0053_oauth_states_expiry_index",
      "0054_agent_access_work_item_snapshots",
      "0055_finance_sync_health",
      "0056_workspace_maintenance_runs",
      "0057_finance_currency_evidence",
      "0058_finance_provider_items",
      "0059_finance_automation_settings",
      "0060_finance_agent_action_reviews",
      "0061_finance_transaction_allocations",
      "0062_finance_reimbursements",
      "0063_finance_maintenance_candidates",
      "0064_finance_ledger_challenges",
      "0065_finance_period_reviews",
      "0066_finance_plan_versions",
      "0067_finance_ledger_protocol",
      "0068_finance_mutation_leases",
      "0069_finance_legacy_budget_backfill",
      "0070_calendar_stewardship_foundations",
      "0071_calendar_event_links",
      "0072_mail_workspace_stewardship",
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

  it("projects and owner-deletes historical drafts without exposing delivery claims", async () => {
    const [otherUser] = await database.db
      .insert(users)
      .values({
        displayName: "Other Mail User",
        email: "other-mail@example.com",
        passwordHash: "unused",
        planningTimezone: "UTC",
      })
      .returning();
    if (!otherUser) throw new Error("Other user fixture was not created.");
    const [otherAccount] = await database.db
      .insert(calendarAccounts)
      .values({ label: "Other", provider: "google", userId: otherUser.id })
      .returning();
    if (!otherAccount) throw new Error("Other account fixture was not created.");
    const [unsent, uncertain, sent, otherDraft] = await database.db
      .insert(mailDrafts)
      .values([
        {
          accountId: enabledAccountId,
          body: "Unsent body",
          cc: [{ address: "copy@example.com", name: "Copy" }],
          sendStatus: "draft" as const,
          subject: "Unsent historical draft",
          to: [{ address: "to@example.com", name: null }],
          userId,
        },
        {
          accountId: enabledAccountId,
          body: "Uncertain body",
          cc: [],
          sendClaimedAt: new Date("2026-07-15T11:00:00.000Z"),
          sendClaimId: "33333333-3333-4333-8333-333333333333",
          sendStatus: "reconcile" as const,
          subject: "Uncertain historical draft",
          to: [{ address: "to@example.com", name: null }],
          userId,
        },
        {
          accountId: enabledAccountId,
          body: "Sent body",
          cc: [],
          sendStatus: "sent" as const,
          sentAt: new Date("2026-07-15T12:00:00.000Z"),
          subject: "Sent historical draft",
          to: [{ address: "to@example.com", name: null }],
          userId,
        },
        {
          accountId: otherAccount.id,
          body: "Private other body",
          cc: [],
          sendStatus: "draft" as const,
          subject: "Other user's draft",
          to: [{ address: "other@example.com", name: null }],
          userId: otherUser.id,
        },
      ])
      .returning();
    if (!unsent || !uncertain || !sent || !otherDraft) {
      throw new Error("Historical draft fixtures were not created.");
    }

    await expect(service.listLegacyDrafts(userId)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          cc: ["copy@example.com"],
          deliveryState: "unsent",
          id: unsent.id,
          to: ["to@example.com"],
        }),
        expect.objectContaining({ deliveryState: "delivery_unknown", id: uncertain.id }),
        expect.objectContaining({ deliveryState: "sent", id: sent.id }),
      ]),
    );
    expect(await service.listLegacyDrafts(userId)).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: otherDraft.id })]),
    );
    await expect(service.deleteLegacyDraft(userId, otherDraft.id)).rejects.toMatchObject({
      code: "not_found",
    });
    await expect(service.deleteLegacyDraft(userId, unsent.id)).resolves.toBeUndefined();
    await expect(service.listLegacyDrafts(userId)).resolves.not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: unsent.id })]),
    );

    await database.db.delete(mailDrafts).where(eq(mailDrafts.userId, userId));
    await database.db.delete(mailDrafts).where(eq(mailDrafts.userId, otherUser.id));
    await database.db.delete(calendarAccounts).where(eq(calendarAccounts.id, otherAccount.id));
    await database.db.delete(users).where(eq(users.id, otherUser.id));
  });

  it("sends one exact saved draft revision and rejects stale or duplicate confirmation", async () => {
    gateway.send.mockClear();
    const created = await service.createDraft(userId, {
      accountId: enabledAccountId,
      body: "",
      cc: [],
      subject: "",
      to: [],
    });
    expect(created).toMatchObject({ sendStatus: "draft", to: [] });
    const [persistedBeforeUpdate] = await database.db
      .select({ sendStatus: mailDrafts.sendStatus, updatedAt: mailDrafts.updatedAt })
      .from(mailDrafts)
      .where(eq(mailDrafts.id, created.id));
    expect(persistedBeforeUpdate).toEqual({
      sendStatus: "draft",
      updatedAt: new Date(created.updatedAt),
    });

    const updated = await service.updateDraft(userId, created.id, {
      accountId: enabledAccountId,
      body: "Prepared response",
      cc: [],
      expectedUpdatedAt: created.updatedAt,
      subject: "Follow up",
      to: [{ address: "person@example.com", name: null }],
    });
    await expect(
      service.updateDraft(userId, created.id, {
        accountId: enabledAccountId,
        body: "Stale overwrite",
        cc: [],
        expectedUpdatedAt: created.updatedAt,
        subject: "Follow up",
        to: [{ address: "person@example.com", name: null }],
      }),
    ).rejects.toMatchObject({ code: "conflict" });

    await expect(
      service.sendDraft(
        userId,
        { confirmedUpdatedAt: updated.updatedAt, draftId: updated.id },
        mutationContext("send-draft-request"),
      ),
    ).resolves.toBeUndefined();
    expect(gateway.send).toHaveBeenCalledOnce();
    expect(gateway.send).toHaveBeenCalledWith(userId, enabledAccountId, {
      body: "Prepared response",
      cc: [],
      subject: "Follow up",
      to: [{ address: "person@example.com", name: null }],
    });
    await expect(
      service.sendDraft(
        userId,
        { confirmedUpdatedAt: updated.updatedAt, draftId: updated.id },
        mutationContext("duplicate-send-request"),
      ),
    ).rejects.toMatchObject({ code: "conflict" });
    expect(gateway.send).toHaveBeenCalledOnce();

    const [audit] = await database.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.requestId, "send-draft-request"));
    expect(audit).toMatchObject({ action: "mail.sent", entityId: updated.id });
    expect(JSON.stringify(audit)).not.toContain("person@example.com");
    expect(JSON.stringify(audit)).not.toContain("Prepared response");

    await database.db.delete(mailDrafts).where(eq(mailDrafts.id, created.id));
  });

  it("releases proven rejection but blocks retries after ambiguous provider acceptance", async () => {
    const prepare = async (subject: string) => {
      const created = await service.createDraft(userId, {
        accountId: enabledAccountId,
        body: "Prepared response",
        cc: [],
        subject,
        to: [{ address: "person@example.com", name: null }],
      });
      return service.updateDraft(userId, created.id, {
        accountId: enabledAccountId,
        body: "Prepared response",
        cc: [],
        expectedUpdatedAt: created.updatedAt,
        subject,
        to: [{ address: "person@example.com", name: null }],
      });
    };

    const rejected = await prepare("Rejected");
    gateway.send.mockRejectedValueOnce(
      new MailProviderRejectedError("Rejected before acceptance", new Error("safe canary")),
    );
    await expect(
      service.sendDraft(
        userId,
        { confirmedUpdatedAt: rejected.updatedAt, draftId: rejected.id },
        mutationContext("rejected-send-request"),
      ),
    ).rejects.toMatchObject({
      code: "service_unavailable",
      details: { partialEffect: false, retrySafe: true },
    });
    await expect(service.listDrafts(userId)).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: rejected.id, sendStatus: "draft" })]),
    );

    const uncertain = await prepare("Uncertain");
    gateway.send.mockRejectedValueOnce(new Error("ambiguous private provider canary"));
    await expect(
      service.sendDraft(
        userId,
        { confirmedUpdatedAt: uncertain.updatedAt, draftId: uncertain.id },
        mutationContext("uncertain-send-request"),
      ),
    ).rejects.toMatchObject({
      code: "service_unavailable",
      details: { partialEffect: true, reconciliationPersisted: true },
    });
    const [uncertainState] = (await service.listDrafts(userId)).filter(
      (draft) => draft.id === uncertain.id,
    );
    expect(uncertainState).toMatchObject({
      reconciliationState: "sent_mail_review_required",
      sendStatus: "reconcile",
    });
    const sendCallsAfterAmbiguity = gateway.send.mock.calls.length;
    await expect(
      service.sendDraft(
        userId,
        {
          confirmedUpdatedAt: uncertainState?.updatedAt ?? uncertain.updatedAt,
          draftId: uncertain.id,
        },
        mutationContext("unsafe-retry-request"),
      ),
    ).rejects.toMatchObject({ code: "conflict" });
    expect(gateway.send).toHaveBeenCalledTimes(sendCallsAfterAmbiguity);

    await expect(
      service.reconcileDraft(
        userId,
        uncertain.id,
        "not_sent",
        mutationContext("reconcile-not-sent-request"),
      ),
    ).resolves.toMatchObject({ sendStatus: "draft" });
    const [reconcileAudit] = await database.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.requestId, "reconcile-not-sent-request"));
    expect(reconcileAudit).toMatchObject({ action: "mail.send_reconciled" });
    expect(JSON.stringify(reconcileAudit)).not.toContain("person@example.com");
    expect(JSON.stringify(reconcileAudit)).not.toContain("Prepared response");

    await database.db.delete(mailDrafts).where(eq(mailDrafts.id, rejected.id));
    await database.db.delete(mailDrafts).where(eq(mailDrafts.id, uncertain.id));
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
    await expect(service.listThreads(userId, { limit: 100, starred: true })).resolves.toEqual([
      expect.objectContaining({ id: threadId }),
    ]);
    await service.snoozeThread(userId, threadId, new Date("2026-07-18T12:00:00.000Z"));
    await expect(service.listThreads(userId, { limit: 100, snoozed: true })).resolves.toEqual([
      expect.objectContaining({ id: threadId }),
    ]);
    await expect(
      service.listThreads(userId, { limit: 100, mailboxId: disabledAccountId }),
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("validates and persists only explicit thread organization changes", async () => {
    const observed = await service.getThread(userId, threadId);
    gateway.update.mockClear();

    await expect(
      service.updateThread(
        userId,
        threadId,
        { expectedUpdatedAt: "2026-01-01T00:00:00.000Z", starred: false },
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
    await expect(
      service.updateThread(
        userId,
        threadId,
        { mailboxIds: [disabledAccountId] },
        { actorId: userId, actorType: "user" },
        "foreign-thread-mailbox",
      ),
    ).rejects.toMatchObject({ code: "invalid_request" });
    await expect(
      service.updateThread(
        userId,
        disabledAccountId,
        { starred: true },
        { actorId: userId, actorType: "user" },
        "missing-thread-update",
      ),
    ).rejects.toMatchObject({ code: "not_found" });
    await expect(
      service.snoozeThread(userId, disabledAccountId, new Date("2026-07-18T12:00:00.000Z")),
    ).rejects.toMatchObject({ code: "not_found" });
    expect(gateway.update).not.toHaveBeenCalled();

    const organized = await service.updateThread(
      userId,
      threadId,
      {
        expectedUpdatedAt: observed.updatedAt,
        mailboxIds: [customLabelId],
        starred: false,
        unread: false,
      },
      { actorId: userId, actorType: "user" },
      "organize-thread",
    );
    expect(organized).toMatchObject({
      mailboxIds: [customLabelId],
      starred: false,
      unread: false,
    });
    expect(gateway.update).toHaveBeenLastCalledWith(userId, enabledAccountId, "thread-1", {
      addMailboxIds: ["Label_Orders"],
      removeMailboxIds: ["STARRED", "UNREAD", "INBOX"],
    });

    const restored = await service.updateThread(
      userId,
      threadId,
      {
        expectedUpdatedAt: organized.updatedAt,
        mailboxIds: [inboxId],
        starred: true,
        unread: true,
      },
      { actorId: userId, actorType: "user" },
      "restore-thread",
    );
    expect(restored).toMatchObject({ mailboxIds: [inboxId], starred: true, unread: true });
    expect(gateway.update).toHaveBeenLastCalledWith(userId, enabledAccountId, "thread-1", {
      addMailboxIds: ["STARRED", "UNREAD", "INBOX"],
      removeMailboxIds: ["Label_Orders"],
    });

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
      failures: [{ error: { code: "not_found", details: null }, id: disabledAccountId }],
      updatedCount: 0,
      updatedIds: [],
    });
  });

  it("maps multi-inbox setup and serializes source-derived Mail attention", async () => {
    await expect(service.listSetupContext(userId)).resolves.toMatchObject({
      automation: { lastCompletedAt: null, oldestDueAt: null },
      commitmentIntake: { previewOnlyCount: 0 },
    });
    const [sparseICloudAccount] = await database.db
      .insert(calendarAccounts)
      .values({
        calendarEnabled: false,
        email: null,
        label: "iCloud Mail",
        lastSyncAttemptAt: new Date("2026-07-16T09:55:00.000Z"),
        lastSyncedAt: new Date("2026-07-16T10:00:00.000Z"),
        mailEnabled: true,
        nextSyncAt: new Date("2026-07-16T10:05:00.000Z"),
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
    await database.db.insert(mailCalendarCommitmentIntakes).values([
      {
        accountId: enabledAccountId,
        attachment: {
          contentType: "text/calendar",
          filename: "preview.ics",
          id: "setup-preview-part",
          size: 64,
        },
        attachmentFingerprint: "a".repeat(64),
        evidenceKind: "calendar_attachment_metadata",
        idempotencyKey: "b".repeat(64),
        remoteMessageId: "setup-preview-message",
        remotePartId: "setup-preview-part",
        remoteThreadId: "thread-1",
        sourceFingerprint: "c".repeat(64),
        sourceThreadId: threadId,
        sourceThreadRevision: statusSourceUpdatedAt,
        userId,
      },
      {
        accountId: enabledAccountId,
        attachment: {
          contentType: "text/calendar",
          filename: "verified.ics",
          id: "setup-verified-part",
          size: 64,
        },
        attachmentFingerprint: "d".repeat(64),
        authority: "server_verified",
        evidenceKind: "verified_calendar_attachment",
        idempotencyKey: "e".repeat(64),
        remoteMessageId: "setup-verified-message",
        remotePartId: "setup-verified-part",
        remoteThreadId: "thread-1",
        sourceFingerprint: "f".repeat(64),
        sourceThreadId: threadId,
        sourceThreadRevision: statusSourceUpdatedAt,
        status: "pending",
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
          health: expect.objectContaining({ state: "ready" }),
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
          lastSyncAttemptAt: "2026-07-16T09:55:00.000Z",
          lastSyncedAt: "2026-07-16T10:00:00.000Z",
          mailboxes: [],
          nextSyncAt: "2026-07-16T10:05:00.000Z",
          provider: "icloud",
        },
      ],
      commitmentIntake: {
        automaticCreationEnabled: false,
        previewOnlyCount: 1,
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
        version: 1,
      },
      {
        domain: "mail",
        importance: "high",
        kind: "important",
        relatedEntityType: "mail_thread",
        status: "open",
        version: 2,
      },
      {
        domain: "mail",
        importance: "high",
        kind: "important",
        relatedEntityType: "mail_thread",
        status: "open",
        version: 3,
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
    const [foreignAccount] = await database.db
      .insert(calendarAccounts)
      .values({ label: "Foreign", provider: "google", userId })
      .returning();
    if (!foreignAccount) throw new Error("Foreign account fixture is missing.");
    const [foreignLabel] = await database.db
      .insert(mailboxes)
      .values({
        accountId: foreignAccount.id,
        name: "Other label",
        provider: "google",
        remoteMailboxId: "Label_Other",
        role: "custom",
        userId,
      })
      .returning();
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

    let partial = await service.updateRule(
      rule.id,
      { description: "Updated without changing matching behavior.", expectedVersion: 2 },
      context,
    );
    partial = await service.updateRule(
      rule.id,
      {
        condition: { field: "subject", operator: "contains", value: "Project" },
        expectedVersion: partial.version,
      },
      context,
    );
    partial = await service.updateRule(
      rule.id,
      { confidenceThreshold: null, expectedVersion: partial.version },
      context,
    );
    partial = await service.updateRule(
      rule.id,
      { expectedVersion: partial.version, profileId },
      context,
    );
    partial = await service.updateRule(
      rule.id,
      { expectedVersion: partial.version, sourceIds: [enabledAccountId] },
      context,
    );
    expect(partial).toMatchObject({
      profileId,
      sourceIds: [enabledAccountId],
      version: 7,
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
      service.activateRule(
        noProfile.id,
        {
          ...(await activationInputFor(noProfile)),
          expectedPreviewedAt: "2026-07-16T13:01:01.000Z",
        },
        context,
      ),
    ).rejects.toThrow("review expired");
    await expect(
      service.activateRule(noProfile.id, await activationInputFor(noProfile), context),
    ).rejects.toThrow("Link an active Mail profile");

    const ambiguousTrash = await service.createRule(
      {
        ...baseRule,
        actions: [
          { afterDays: 1, mailboxId: null, type: "trash" },
          { afterDays: 0, mailboxId: null, type: "mark_read" },
        ],
        name: "Ambiguous Trash recovery",
        profileId,
        sourceIds: [enabledAccountId],
      },
      context,
    );
    await expect(
      service.activateRule(ambiguousTrash.id, await activationInputFor(ambiguousTrash), context),
    ).rejects.toThrow("Trash as its only action");

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
