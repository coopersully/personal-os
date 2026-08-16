import {
  accountSetupStateSchema,
  actorTypeSchema,
  addLocalDays,
  addMonths,
  agentAccessWorkItemPageSchema,
  agentAccessWorkItemQuerySchema,
  agentConnectionGuideSchema,
  agentMutationPolicies,
  apiErrorSchema,
  applyFinanceCategorizationsInputSchema,
  archiveTaskListInputSchema,
  assistantSetupPlanQuerySchema,
  assistantSetupPlanSchema,
  bulkUpdateMailInputSchema,
  calendarCommitmentCandidateSchema,
  calendarEventSchema,
  calendarProfilePreferencesSchema,
  calendarProviderSchema,
  calendarSchema,
  cancelTaskInputSchema,
  completeTaskInputSchema,
  completeTaskProjectInputSchema,
  connectedAccountHealthSchema,
  connectICloudInputSchema,
  connectorAuthorizationOutcomeSchema,
  connectorCapabilities,
  createAccessTokenInputSchema,
  createAttentionItemInputSchema,
  createEventBlockInputSchema,
  createEventInputSchema,
  createGoalInputSchema,
  createLocalCalendarInputSchema,
  createMailRuleInputSchema,
  createMotiveInputSchema,
  createReminderInputSchema,
  createTaskInputSchema,
  createTaskListInputSchema,
  createTaskProjectInputSchema,
  dailyBriefSchema,
  eventListQuerySchema,
  featureAccessPolicies,
  featureIds,
  financeGuidedPreferencesSchema,
  financeReviewDecisionInputSchema,
  financeTransactionQuerySchema,
  formatDateOnly,
  formatDateWithOrdinal,
  formatMonth,
  idSchema,
  invitationCodeSchema,
  isoDateTimeSchema,
  localDateAt,
  localDateRange,
  localDateTimeToUtc,
  localDayRange,
  localWeekRange,
  loginInputSchema,
  mailboxRoleSchema,
  mailboxSchema,
  mailListQuerySchema,
  mailProviderSchema,
  mailRuleActionIsDue,
  mailRuleActionSchema,
  mailThreadSchema,
  matchesMailRule,
  materialSourceReferenceSchema,
  normalizeTaskContainerName,
  paginationSchema,
  passwordRequirementState,
  passwordSchema,
  previewCalendarCommitmentInputSchema,
  registerInputSchema,
  reminderDeferralPreviewInputSchema,
  reminderListQuerySchema,
  reminderPrioritySchema,
  reminderProfilePreferencesSchema,
  reminderSchema,
  reminderTimeZoneSchema,
  reopenTaskInputSchema,
  resolveStoredMailRule,
  semanticVersionSchema,
  sendMailInputSchema,
  startGoogleAuthorizationInputSchema,
  taskContainerAvailabilitySchema,
  taskLifecycleSchema,
  taskListArchiveConflictSchema,
  taskListQuerySchema,
  taskListSchema,
  taskMovePreviewSchema,
  taskOrganizationConflictSchema,
  taskProjectCompletionConflictSchema,
  taskProjectCompletionResolutionSchema,
  taskProjectSchema,
  taskSchema,
  taskSystemViewSchema,
  timeZoneSchema,
  updateAccountSetupInputSchema,
  updateEventBlockInputSchema,
  updateEventInputSchema,
  updateFinanceTransactionInputSchema,
  updateGoalInputSchema,
  updateLocalCalendarInputSchema,
  updateMailRuleInputSchema,
  updateMailThreadInputSchema,
  updateMotiveInputSchema,
  updateReminderInputSchema,
  updateTaskInputSchema,
  updateUserInputSchema,
  upsertDomainProfileInputSchema,
  upsertMailProfileInputSchema,
  upsertReminderAttentionItemInputSchema,
  upsertReminderProfileInputSchema,
  userSchema,
  weatherLocationOptionSchema,
  weatherLocationSearchQuerySchema,
  weatherQuerySchema,
  weatherSnapshotSchema,
} from "./index.js";

const id = "11111111-1111-4111-8111-111111111111";
const accountId = "22222222-2222-4222-8222-222222222222";
const start = "2026-07-13T13:00:00.000Z";
const end = "2026-07-13T14:00:00.000Z";

describe("domain schemas", () => {
  it("validates paginated Agent Access work items and local actions", () => {
    const page = agentAccessWorkItemPageSchema.parse({
      filteredTotal: 1,
      items: [
        {
          action: {
            label: "Review Mail rule",
            to: `/settings?section=mail&reviewRule=${id}`,
          },
          actionAt: start,
          domain: "mail",
          id: `mail-rule:${id}`,
          kind: "review",
          priority: "person_review",
          source: {
            accountId,
            provider: "google",
            remoteId: id,
            revision: start,
            sourceType: "mail_thread",
          },
          summary: "Review the current bounded sample before activation.",
          title: "Review Statements",
          updatedAt: start,
        },
      ],
      nextCursor: "opaque-next",
      snapshotAt: start,
      summary: {
        byDomain: { calendar: 0, finances: 0, mail: 1, tasks: 0 },
        byKind: { attention: 0, review: 1 },
        total: 1,
      },
      unavailableDomains: [],
    });

    expect(page.summary).toMatchObject({ total: 1 });
    expect(agentAccessWorkItemQuerySchema.parse({})).toEqual({ limit: 10 });
    expect(
      agentAccessWorkItemQuerySchema.parse({ cursor: "opaque-next", kind: "review", limit: "10" }),
    ).toEqual({ cursor: "opaque-next", kind: "review", limit: 10 });
  });

  it("rejects invalid Agent Access pages and queries", () => {
    expect(agentAccessWorkItemQuerySchema.safeParse({ limit: 11 }).success).toBe(false);
    expect(agentAccessWorkItemQuerySchema.safeParse({ kind: "diagnostic" }).success).toBe(false);
    expect(agentAccessWorkItemQuerySchema.safeParse({ cursor: "" }).success).toBe(false);
    expect(
      agentAccessWorkItemPageSchema.safeParse({
        filteredTotal: 1,
        items: [
          {
            action: { label: "Unsafe route", to: "/\\\\untrusted.example" },
            actionAt: null,
            domain: "mail",
            id: "unsafe-route",
            kind: "review",
            priority: "person_review",
            source: null,
            summary: "This must not be accepted as an in-app route.",
            title: "Unsafe route",
            updatedAt: start,
          },
        ],
        nextCursor: null,
        snapshotAt: start,
        summary: {
          byDomain: { calendar: 0, finances: 0, mail: 1, tasks: 0 },
          byKind: { attention: 0, review: 1 },
          total: 1,
        },
        unavailableDomains: [],
      }).success,
    ).toBe(false);
    expect(
      agentAccessWorkItemPageSchema.safeParse({
        filteredTotal: 1,
        items: [
          {
            action: { label: "Leave Ilo", to: "https://example.com" },
            actionAt: null,
            domain: "mail",
            id: "bad-action",
            kind: "attention",
            priority: "normal",
            source: null,
            summary: "This action is not local.",
            title: "External action",
            updatedAt: start,
          },
        ],
        nextCursor: null,
        snapshotAt: start,
        summary: {
          byDomain: { calendar: 0, finances: 0, mail: 1, tasks: 0 },
          byKind: { attention: 1, review: 0 },
          total: 1,
        },
        unavailableDomains: [],
      }).success,
    ).toBe(false);
  });

  it("exposes stable cross-feature connector and agent-action contracts", () => {
    expect(featureIds).toEqual([
      "automations",
      "bookmarks",
      "calendar",
      "finances",
      "goals",
      "mail",
      "pinterest",
      "reminders",
      "settings",
      "tasks",
    ]);
    expect(agentMutationPolicies).toEqual([
      "read_only",
      "preview",
      "approve_each",
      "approved_rule",
    ]);
    expect(connectorCapabilities).toContain("calendar_write");
    expect(connectorCapabilities).toContain("mail_manage");
    expect(featureAccessPolicies.calendar).toEqual({
      mutationPolicy: "approved_rule",
      readScope: "calendar:read",
      writeScope: "calendar:write",
    });
    expect(featureAccessPolicies.goals.writeScope).toBe("goals:write");
  });

  it("uses shared profile and attention envelopes with domain-owned mail rules", () => {
    expect(
      agentConnectionGuideSchema.parse({
        domains: [
          {
            domain: "mail",
            readScope: "mail:read",
            support: "executable_rules",
            writeScope: "mail:write",
          },
        ],
        mcpUrl: "https://mcp.example.com/mcp",
        skill: {
          displayName: "Ilo Guided Setup",
          installPrompt: "Install the Ilo skill.",
          invocation: "$ilo-setup",
          name: "ilo-setup",
          revision: "release-0.1.0",
          setupPrompt: "Set up Ilo.",
          sourceUrl: "https://example.com/ilo-setup",
          version: "0.1.0",
        },
      }),
    ).toMatchObject({ domains: [{ domain: "mail", support: "executable_rules" }] });
    expect(
      assistantSetupPlanQuerySchema.parse({ domain: "mail", stepId: "learn_preferences" }),
    ).toEqual({ domain: "mail", stepId: "learn_preferences" });
    expect(
      assistantSetupPlanSchema.parse({
        access: { canRead: true, canWrite: true },
        connection: { lastObservedAt: "2026-07-28T12:00:00.000Z", observed: true },
        currentStepId: "learn_preferences",
        domain: "mail",
        nextAction: "Inspect Mail and save a draft.",
        profile: {
          approvedStatus: null,
          approvedVersion: null,
          pendingDraftVersion: null,
          status: null,
          version: null,
        },
        progress: { completed: 1, total: 4 },
        protocolVersion: "1.0",
        selectedStepId: "learn_preferences",
        status: "in_progress",
        steps: [
          {
            completionEvidence: [],
            description: "Inspect existing material.",
            id: "learn_preferences",
            instructions: ["Read the current profile."],
            order: 2,
            owner: "agent",
            requiredTools: ["get_domain_profile"],
            state: "current",
            title: "Learn Mail preferences",
            userAction: null,
          },
        ],
      }),
    ).toMatchObject({ currentStepId: "learn_preferences", protocolVersion: "1.0" });
    expect(semanticVersionSchema.parse("1.2.3-rc.1+build.7")).toBe("1.2.3-rc.1+build.7");
    expect(() => semanticVersionSchema.parse("1.2.3-01")).toThrow();
    expect(
      upsertDomainProfileInputSchema.parse({
        categories: [],
        domain: "mail",
        instructions: ["Keep delivery problems visible."],
        objective: "Keep a clean inbox.",
        preferences: { retentionDays: null },
        sourceContexts: [],
        status: "draft",
        summary: "Only high-signal mail stays visible.",
      }),
    ).toMatchObject({
      domain: "mail",
      preferences: { retentionDays: null },
      status: "draft",
    });
    expect(
      upsertMailProfileInputSchema.parse({
        categories: [],
        domain: "mail",
        instructions: ["Keep delivery problems visible."],
        objective: "Keep a clean inbox.",
        preferences: {
          importantEmailHandling: "inbox_and_attention",
          inboxStyle: "signal_only",
          noiseDisposition: "archive_after_days",
          noiseRetentionDays: 3,
        },
        sourceContexts: [
          {
            notes: null,
            purpose: "Personal decisions",
            sourceId: accountId,
            sourceLabel: "Personal",
          },
        ],
        status: "draft",
        summary: "Only high-signal mail stays visible.",
      }),
    ).toMatchObject({
      preferences: { noiseDisposition: "archive_after_days", noiseRetentionDays: 3 },
    });
    expect(
      upsertMailProfileInputSchema.safeParse({
        categories: [],
        domain: "mail",
        instructions: [],
        objective: "Keep a clean inbox.",
        preferences: {
          noiseDisposition: "trash_after_days",
          noiseRetentionDays: 1,
        },
        sourceContexts: [],
        status: "draft",
        summary: "One-day recoverable Trash.",
      }).success,
    ).toBe(true);
    expect(
      upsertMailProfileInputSchema.safeParse({
        categories: [],
        domain: "mail",
        instructions: [],
        objective: "Complete Mail setup.",
        preferences: {},
        sourceContexts: [],
        status: "active",
        summary: "No inbox was mapped.",
      }).success,
    ).toBe(false);
    expect(
      upsertMailProfileInputSchema.safeParse({
        categories: [],
        domain: "mail",
        instructions: [],
        objective: "Keep a clean inbox.",
        preferences: {},
        sourceContexts: [
          {
            notes: null,
            purpose: "Personal",
            sourceId: accountId,
            sourceLabel: "Personal",
          },
          {
            notes: null,
            purpose: "Work",
            sourceId: accountId,
            sourceLabel: "Duplicate",
          },
        ],
        status: "draft",
        summary: "Conflicting source meanings.",
      }).success,
    ).toBe(false);
    const reminderPreferences = {
      defaultCapture: "due_when_stated",
      dueAtMeaning: "deadline",
      notificationLeadMinutes: 30,
      overdueBehavior: "propose_deferral",
      overdueReviewAfterDays: 2,
      preferredAutomaticActions: ["create", "complete"],
      preferredMutationPolicy: "approve_each",
      priorityHighMeaning: "Needs attention today",
      priorityLowMeaning: "Optional when convenient",
      priorityMediumMeaning: "Should happen soon",
      reviewPriorityAtOrAbove: "medium",
      timezoneBehavior: "ask_when_ambiguous",
    } as const;
    expect(reminderProfilePreferencesSchema.parse(reminderPreferences)).toEqual(
      reminderPreferences,
    );
    expect(
      reminderProfilePreferencesSchema.safeParse({
        ...reminderPreferences,
        preferredMutationPolicy: "approved_rule",
      }).success,
    ).toBe(false);
    expect(
      upsertReminderProfileInputSchema.parse({
        categories: [],
        domain: "reminders",
        instructions: [],
        objective: "Keep commitments visible.",
        preferences: { priorityHighMeaning: "  Needs attention today  " },
        sourceContexts: [],
        status: "draft",
        summary: "Partial Reminder setup.",
      }),
    ).toMatchObject({
      domain: "reminders",
      preferences: { priorityHighMeaning: "Needs attention today" },
      status: "draft",
    });
    expect(
      upsertReminderProfileInputSchema.safeParse({
        categories: [],
        domain: "reminders",
        instructions: [],
        objective: "Keep commitments visible.",
        preferences: {},
        sourceContexts: [],
        status: "active",
        summary: "Incomplete Reminder setup.",
      }).success,
    ).toBe(false);
    expect(
      upsertReminderProfileInputSchema.safeParse({
        categories: [],
        domain: "reminders",
        instructions: [],
        objective: "Keep commitments visible.",
        preferences: reminderPreferences,
        sourceContexts: [],
        status: "active",
        summary: "Complete Reminder setup.",
      }).success,
    ).toBe(true);
    expect(
      createAttentionItemInputSchema.parse({
        domain: "calendar",
        expiresAt: null,
        importance: "high",
        kind: "upcoming",
        occursAt: start,
        relatedEntityId: null,
        relatedEntityType: null,
        source: null,
        summary: "A commitment is approaching.",
        title: "Upcoming commitment",
      }),
    ).toMatchObject({ domain: "calendar", kind: "upcoming" });
    expect(
      matchesMailRule(
        { field: "sender", operator: "ends_with", value: "@example.com" },
        {
          from: { address: "orders@example.com", name: "Orders" },
          snippet: "Your order shipped",
          subject: "Shipment",
        },
      ),
    ).toBe(true);
    expect(
      mailRuleActionIsDue(
        { afterDays: 1, mailboxId: null, type: "trash" },
        "2026-07-26T12:00:00.000Z",
        new Date("2026-07-28T12:00:00.000Z"),
      ),
    ).toBe(true);
    expect(
      mailRuleActionIsDue(
        { afterDays: 3, mailboxId: null, type: "trash" },
        new Date("2026-07-26T12:00:00.000Z"),
        new Date("2026-07-28T12:00:00.000Z"),
      ),
    ).toBe(false);
    expect(
      matchesMailRule(
        { field: "subject", operator: "equals", value: "shipment" },
        {
          from: { address: "orders@example.com", name: null },
          snippet: "Your order shipped",
          subject: "Shipment",
        },
      ),
    ).toBe(true);
    expect(
      matchesMailRule(
        { field: "snippet", operator: "contains", value: "missing" },
        {
          from: { address: "orders@example.com", name: null },
          snippet: "Your order shipped",
          subject: "Shipment",
        },
      ),
    ).toBe(false);
    expect(
      matchesMailRule(
        { field: "any", operator: "contains", value: "orders@example.com" },
        {
          from: { address: "orders@example.com", name: null },
          snippet: "Your order shipped",
          subject: "Shipment",
        },
      ),
    ).toBe(true);
    expect(
      mailRuleActionSchema.safeParse({
        mailboxId: accountId,
        type: "add_label",
      }).success,
    ).toBe(true);
    expect(mailRuleActionSchema.safeParse({ type: "add_label" }).success).toBe(false);
    expect(
      mailRuleActionSchema.safeParse({
        mailboxId: accountId,
        type: "archive",
      }).success,
    ).toBe(false);
    expect(
      resolveStoredMailRule({
        action: "mark_read",
        actions: null,
        condition: null,
        enabled: true,
        policy: "preview",
        query: "legacy sender",
      }),
    ).toEqual({
      actions: [{ afterDays: 0, mailboxId: null, type: "mark_read" }],
      condition: { field: "any", operator: "contains", value: "legacy sender" },
      policy: "approved_rule",
    });
    expect(
      updateMailRuleInputSchema.parse({
        expectedVersion: 1,
        name: "Updated rule",
      }),
    ).toEqual({
      expectedVersion: 1,
      name: "Updated rule",
    });
    expect(
      createMailRuleInputSchema.safeParse({
        actions: [{ afterDays: 0, mailboxId: null, type: "archive" }],
        condition: { field: "sender", operator: "contains", value: "news" },
        enabled: true,
        name: "Unsafe active rule",
        policy: "approved_rule",
      }).success,
    ).toBe(false);
    expect(
      sendMailInputSchema.parse({
        accountId: "00000000-0000-4000-8000-000000000001",
        body: "No subject",
        subject: "   ",
        to: [{ address: "To@Example.COM", name: null }],
      }),
    ).toMatchObject({
      subject: "",
      to: [{ address: "To@Example.COM", name: null }],
    });
    expect(
      createMailRuleInputSchema.safeParse({
        actions: [{ afterDays: 0, mailboxId: null, type: "mark_read" }],
        condition: { field: "sender", operator: "contains", value: "news" },
        confidenceThreshold: 0.9,
        name: "Decorative confidence",
      }).success,
    ).toBe(false);
    expect(
      updateMailRuleInputSchema.safeParse({
        enabled: true,
        expectedVersion: 1,
      }).success,
    ).toBe(false);
    expect(
      updateMailRuleInputSchema.safeParse({
        expectedVersion: 1,
        policy: "approve_each",
      }).success,
    ).toBe(false);
    expect(
      createMailRuleInputSchema.safeParse({
        actions: [{ afterDays: 0, mailboxId: null, type: "mark_read" }],
        condition: { field: "sender", operator: "contains", value: "news" },
        name: "Duplicate source draft",
        sourceIds: ["00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000001"],
      }).success,
    ).toBe(false);
    expect(
      updateMailRuleInputSchema.safeParse({
        expectedVersion: 1,
        sourceIds: ["00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000001"],
      }).success,
    ).toBe(false);
  });

  it("formats calendar dates without timezone drift", () => {
    expect(formatDateWithOrdinal("2026-06-06")).toBe("June 6th");
    expect(formatMonth("2026-06")).toBe("June 2026");
    expect(addMonths("2026-01", -1)).toBe("2025-12");
    expect(addMonths("2026-12", 1)).toBe("2027-01");
    expect(formatDateOnly("2026-06-06", { day: "numeric", month: "short", year: "numeric" })).toBe(
      "Jun 6, 2026",
    );
  });

  it("parses common, auth, and reminder values", () => {
    expect(idSchema.parse(id)).toBe(id);
    expect(isoDateTimeSchema.parse(start)).toBe(start);
    expect(timeZoneSchema.parse(" America/New_York ")).toBe("America/New_York");
    expect(paginationSchema.parse({ limit: "10" })).toEqual({ limit: 10 });
    expect(paginationSchema.parse({}).limit).toBe(50);
    expect(actorTypeSchema.options).toEqual(["user", "agent", "connector", "system"]);
    expect(
      apiErrorSchema.parse({ error: { code: "x", message: "m", requestId: "r" } }),
    ).toBeTruthy();

    expect(
      registerInputSchema.parse({
        displayName: "Test",
        email: "UPPER@EXAMPLE.COM",
        password: "LocalTestOnly123!",
      }).email,
    ).toBe("upper@example.com");
    expect(
      registerInputSchema.parse({
        displayName: "Test",
        email: "a@example.com",
        password: "LocalTestOnly123!",
      }).planningTimezone,
    ).toBe("UTC");
    expect(loginInputSchema.parse({ email: "UPPER@EXAMPLE.COM", password: "x" }).email).toBe(
      "upper@example.com",
    );
    expect(invitationCodeSchema.parse("abcd2345")).toBe("ABCD2345");
    expect(invitationCodeSchema.safeParse("too-short").success).toBe(false);
    expect(invitationCodeSchema.safeParse("ABCD-234").success).toBe(false);
    expect(passwordSchema.safeParse("alllowercase123!").success).toBe(false);
    expect(passwordSchema.safeParse("ALLUPPERCASE123!").success).toBe(false);
    expect(passwordSchema.safeParse("NoNumbersHere!").success).toBe(false);
    expect(passwordSchema.safeParse("NoSymbolsHere123").success).toBe(false);
    expect(passwordRequirementState("LocalTestOnly123!")).toEqual({
      length: true,
      mixedCase: true,
      number: true,
      symbol: true,
    });
    expect(passwordRequirementState("short")).toEqual({
      length: false,
      mixedCase: false,
      number: false,
      symbol: false,
    });
    expect(
      updateAccountSetupInputSchema.parse({
        action: "progress",
        currentStep: "verify_email",
        selectedWorkspaces: ["calendar", "mail"],
      }),
    ).toMatchObject({ currentStep: "verify_email", selectedWorkspaces: ["calendar", "mail"] });
    expect(startGoogleAuthorizationInputSchema.parse({})).toEqual({
      returnTo: "/settings?section=connections",
      services: ["calendar", "mail"],
    });
    const setup = accountSetupStateSchema.parse({
      completedAt: null,
      currentStep: "welcome",
      dismissedAt: null,
      selectedWorkspaces: ["calendar", "tasks"],
      startedAt: null,
      status: "not_started",
    });
    expect(
      userSchema.parse({
        accentColor: "#c7d23c",
        emailVerified: true,
        id,
        displayName: "Test",
        email: "a@example.com",
        setup,
        theme: "system",
        planningTimezone: "UTC",
        workdayEndMinute: 17 * 60,
        workdayStartMinute: 9 * 60,
        createdAt: start,
        updatedAt: start,
      }).id,
    ).toBe(id);
    expect(updateUserInputSchema.parse({ accentColor: "#6c9cff" }).accentColor).toBe("#6c9cff");
    expect(updateUserInputSchema.parse({ theme: "dark" }).theme).toBe("dark");
    expect(
      updateUserInputSchema.parse({
        homeLocation: {
          coordinates: { latitude: 40.6782, longitude: -73.9442 },
          label: " Brooklyn, NY ",
        },
      }),
    ).toEqual({
      homeLocation: {
        coordinates: { latitude: 40.6782, longitude: -73.9442 },
        label: "Brooklyn, NY",
      },
    });
    expect(
      updateUserInputSchema.parse({
        displayName: "  Updated Test  ",
        email: "UPDATED@EXAMPLE.COM",
        planningTimezone: "America/New_York",
      }),
    ).toMatchObject({
      displayName: "Updated Test",
      email: "updated@example.com",
      planningTimezone: "America/New_York",
    });
    expect(() => updateUserInputSchema.parse({ accentColor: "blue" })).toThrow();
    expect(() => updateUserInputSchema.parse({})).toThrow();
    expect(weatherQuerySchema.parse({ latitude: "40.7", longitude: "-74" })).toEqual({
      latitude: 40.7,
      longitude: -74,
    });
    expect(() => weatherQuerySchema.parse({ latitude: 40.7 })).toThrow();
    expect(weatherLocationSearchQuerySchema.parse({ query: "  New York  " })).toEqual({
      query: "New York",
    });
    expect(() => weatherLocationSearchQuerySchema.parse({ query: "N" })).toThrow();
    expect(
      weatherLocationOptionSchema.parse({
        coordinates: { latitude: 40.7128, longitude: -74.006 },
        label: "New York, New York, United States",
      }),
    ).toEqual({
      coordinates: { latitude: 40.7128, longitude: -74.006 },
      label: "New York, New York, United States",
    });
    expect(
      weatherSnapshotSchema.parse({
        alerts: [{ kind: "rain", label: "Rain now" }],
        condition: "Rain",
        location: {
          city: "New York",
          coordinates: { latitude: 40.7, longitude: -74 },
          country: "United States",
          label: "New York, New York, United States",
          mapUrl: "https://www.openstreetmap.org/?mlat=40.7&mlon=-74#map=12/40.7/-74",
          region: "New York",
          shortLabel: "NYC",
          source: "device",
        },
        observedAt: start,
        temperatureF: 72,
        usAqi: 42,
      }),
    ).toMatchObject({ condition: "Rain", temperatureF: 72 });
    expect(updateFinanceTransactionInputSchema.parse({ notes: "Receipt saved" })).toEqual({
      notes: "Receipt saved",
    });
    expect(
      financeReviewDecisionInputSchema.parse({
        action: "recategorize",
        categoryId: "00000000-0000-4000-8000-000000000000",
        confidence: 0.965,
        expectedTransactionUpdatedAt: start,
      }),
    ).toMatchObject({
      confidence: 0.965,
      expectedTransactionUpdatedAt: start,
      learnMerchant: "suggest",
    });
    expect(
      financeReviewDecisionInputSchema.safeParse({
        action: "approve",
      }).success,
    ).toBe(false);
    expect(
      financeReviewDecisionInputSchema.safeParse({
        action: "recategorize",
        expectedTransactionUpdatedAt: start,
      }).success,
    ).toBe(false);
    expect(() => updateFinanceTransactionInputSchema.parse({ learnMerchant: false })).toThrow();
    expect(
      createAccessTokenInputSchema.parse({ name: "Agent", scopes: ["audit:read", "audit:read"] })
        .scopes,
    ).toEqual(["audit:read"]);
    const brief = dailyBriefSchema.parse({
      allDay: [],
      anytime: [],
      capacity: {
        availableMinutes: 240,
        busyMinutes: 0,
        flexibleTaskMinutes: 0,
        overcommitted: false,
        scheduledTaskMinutes: 0,
        workdayEndsAt: "2026-07-13T17:00:00.000Z",
        workdayStartsAt: "2026-07-13T09:00:00.000Z",
      },
      generatedAt: start,
      laterToday: [],
      next: null,
      now: [],
      overdue: [],
      timeZone: "UTC",
      tasks: [],
      completedTasks: [],
      today: [],
      tomorrow: [],
    });
    expect(brief.timeZone).toBe("UTC");

    expect(reminderPrioritySchema.parse("high")).toBe("high");
    expect(createReminderInputSchema.parse({ title: " Test " })).toEqual({
      title: "Test",
      notes: null,
      dueAt: null,
      timezone: null,
      priority: "medium",
    });
    expect(updateReminderInputSchema.safeParse({}).success).toBe(false);
    expect(updateReminderInputSchema.parse({ notes: null })).toEqual({ notes: null });
    expect(
      reminderSchema.parse({
        id,
        title: "Test",
        createdAt: start,
        updatedAt: start,
        completedAt: null,
        source: {
          accountId: null,
          provider: "local",
          remoteId: id,
          revision: start,
          sourceType: "reminder",
        },
      }).priority,
    ).toBe("medium");
    expect(
      reminderDeferralPreviewInputSchema.parse({
        overdueBefore: start,
        proposedDueAt: end,
      }),
    ).toMatchObject({ limit: 100, timezone: null });
    expect(
      reminderDeferralPreviewInputSchema.safeParse({
        overdueBefore: end,
        proposedDueAt: start,
      }).success,
    ).toBe(false);
    expect(
      reminderDeferralPreviewInputSchema.safeParse({
        overdueBefore: start,
        proposedDueAt: start,
      }).success,
    ).toBe(false);
    expect(reminderTimeZoneSchema.safeParse("definitely/not-a-zone").success).toBe(false);
    expect(
      reminderDeferralPreviewInputSchema.safeParse({
        overdueBefore: start,
        proposedDueAt: end,
        timezone: "definitely/not-a-zone",
      }).success,
    ).toBe(false);
    expect(
      upsertReminderAttentionItemInputSchema.parse({
        summary: "Clarify what needs to happen.",
        title: "Reminder needs review",
      }),
    ).toMatchObject({
      importance: "high",
      kind: "follow_up",
    });
    expect(reminderListQuerySchema.parse({ completed: "true" }).completed).toBe(true);
    expect(reminderListQuerySchema.parse({ completed: "false" }).completed).toBe(false);
    expect(
      reminderListQuerySchema.safeParse({
        dueAfter: "2026-07-14T00:00:00.000Z",
        dueBefore: "2026-07-13T00:00:00.000Z",
      }).success,
    ).toBe(false);

    const listId = "33333333-3333-4333-8333-333333333333";
    const projectId = "44444444-4444-4444-8444-444444444444";
    const idempotencyKey = "55555555-5555-4555-8555-555555555555";

    for (const [schema, allowed] of [
      [taskLifecycleSchema, ["open", "completed", "cancelled"]],
      [taskContainerAvailabilitySchema, ["active", "archived"]],
      [taskSystemViewSchema, ["today", "upcoming", "scheduled", "completed", "cancelled", "trash"]],
    ] as const) {
      expect(schema.options).toEqual(allowed);
      expect(schema.safeParse("not-a-value").success).toBe(false);
    }

    expect(normalizeTaskContainerName("  Caf\u00e9\t\uff37\uff4f\uff52\uff4b  ")).toBe(
      "caf\u00e9 work",
    );
    const inboxCapture = createTaskInputSchema.parse({ idempotencyKey, title: " Inbox task " });
    expect(inboxCapture).toMatchObject({
      estimateMinutes: null,
      lifecycle: "open",
      title: "Inbox task",
    });
    expect(inboxCapture).not.toHaveProperty("listId");
    expect(inboxCapture).not.toHaveProperty("projectId");
    expect(
      createTaskInputSchema.safeParse({
        source: {
          accountId: null,
          provider: "local",
          remoteId: id,
          revision: "1",
          sourceType: "task",
        },
        title: "Local only",
      }).success,
    ).toBe(false);
    expect(
      createTaskInputSchema.parse({
        scheduledAt: "2026-07-14T13:00:00.000Z",
        title: "Scheduled independently",
      }),
    ).toMatchObject({ lifecycle: "open", scheduledAt: "2026-07-14T13:00:00.000Z" });
    expect(
      createTaskInputSchema.safeParse({
        childProject: { id: projectId },
        title: "Task cannot contain a Project",
      }).success,
    ).toBe(false);
    expect(
      createTaskListInputSchema.safeParse({
        childList: { name: "Nested" },
        name: "Personal",
      }).success,
    ).toBe(false);
    expect(
      createTaskListInputSchema.safeParse({
        name: "Local only",
        source: {
          accountId: null,
          provider: "local",
          remoteId: listId,
          revision: "1",
          sourceType: "task_list",
        },
      }).success,
    ).toBe(false);
    expect(
      createTaskProjectInputSchema.safeParse({
        childProject: { name: "Nested" },
        listId,
        name: "Launch",
      }).success,
    ).toBe(false);
    expect(
      createTaskProjectInputSchema.safeParse({
        listId,
        name: "Local only",
        source: {
          accountId: null,
          provider: "local",
          remoteId: projectId,
          revision: "1",
          sourceType: "task_project",
        },
      }).success,
    ).toBe(false);
    expect(updateTaskInputSchema.safeParse({ expectedRevision: 1 }).success).toBe(false);
    expect(
      updateTaskInputSchema.safeParse({ expectedRevision: 0, title: "Invalid revision" }).success,
    ).toBe(false);
    expect(
      updateTaskInputSchema.safeParse({ expectedRevision: 1.5, title: "Invalid revision" }).success,
    ).toBe(false);
    expect(updateTaskInputSchema.parse({ expectedRevision: 1, estimateMinutes: null })).toEqual({
      estimateMinutes: null,
      expectedRevision: 1,
    });
    expect(createTaskInputSchema.parse({ tags: ["work", "work"], title: "Tag task" }).tags).toEqual(
      ["work"],
    );
    expect(taskProjectCompletionResolutionSchema.options).toEqual([
      "complete_open_tasks",
      "cancel_open_tasks",
      "move_open_tasks",
      "keep_project_open",
    ]);
    expect(
      archiveTaskListInputSchema.safeParse({ resolution: "move_active_contents" }).success,
    ).toBe(false);
    expect(
      completeTaskProjectInputSchema.safeParse({ resolution: "move_open_tasks" }).success,
    ).toBe(false);
    expect(
      taskMovePreviewSchema.parse({
        destinationListId: listId,
        destinationListRevision: 3,
        destinationProjectId: null,
        destinationProjectRevision: null,
        detachedProjectId: projectId,
        previewToken: "task-move-preview",
        sourceListId: listId,
        sourceListRevision: 2,
        sourceProjectId: projectId,
        taskId: id,
        taskRevision: 4,
      }).detachedProjectId,
    ).toBe(projectId);
    expect(
      materialSourceReferenceSchema.parse({
        accountId: null,
        provider: "local",
        remoteId: listId,
        revision: "1",
        sourceType: "task_list",
      }).sourceType,
    ).toBe("task_list");
    expect(
      materialSourceReferenceSchema.parse({
        accountId: null,
        provider: "local",
        remoteId: projectId,
        revision: "1",
        sourceType: "task_project",
      }).sourceType,
    ).toBe("task_project");
    const taskList = taskListSchema.parse({
      archivedAt: null,
      availability: "active",
      color: null,
      createdAt: start,
      deletedAt: null,
      description: null,
      id: listId,
      kind: "inbox",
      name: "Inbox",
      revision: 1,
      source: {
        accountId: null,
        provider: "local",
        remoteId: listId,
        revision: "1",
        sourceType: "task_list",
      },
      updatedAt: start,
    });
    expect(taskList).toMatchObject({
      deletedAt: null,
      kind: "inbox",
      source: { provider: "local", remoteId: listId, revision: "1" },
    });
    expect(taskListSchema.safeParse({ ...taskList, source: null }).success).toBe(false);
    expect(
      taskListSchema.safeParse({
        ...taskList,
        source: { ...taskList.source, accountId: id, provider: "google" },
      }).success,
    ).toBe(false);
    const taskProject = taskProjectSchema.parse({
      archivedAt: null,
      availability: "active",
      cancelledAt: null,
      completedAt: null,
      createdAt: start,
      deletedAt: null,
      id: projectId,
      lifecycle: "open",
      listId,
      name: "Launch",
      notes: null,
      revision: 1,
      source: {
        accountId: null,
        provider: "local",
        remoteId: projectId,
        revision: "1",
        sourceType: "task_project",
      },
      targetDate: null,
      updatedAt: start,
      why: null,
    });
    expect(taskProject).toMatchObject({
      deletedAt: null,
      lifecycle: "open",
      source: { provider: "local", remoteId: projectId, revision: "1" },
    });
    expect(taskProjectSchema.safeParse({ ...taskProject, source: null }).success).toBe(false);
    const canonicalTask = taskSchema.parse({
      cancelledAt: null,
      completedAt: null,
      createdAt: start,
      deletedAt: null,
      estimateMinutes: null,
      id,
      legacyStatus: "scheduled",
      lifecycle: "open",
      listId,
      notes: null,
      priority: "medium",
      projectId: projectId,
      revision: 1,
      scheduledAt: "2026-07-14T13:00:00.000Z",
      source: {
        accountId: null,
        provider: "local",
        remoteId: id,
        revision: "1",
        sourceType: "task",
      },
      tags: [],
      timezone: null,
      title: "Task",
      updatedAt: start,
      why: null,
      dueAt: null,
    });
    expect(canonicalTask).toMatchObject({
      deletedAt: null,
      lifecycle: "open",
      source: { provider: "local", remoteId: id, revision: "1", sourceType: "task" },
    });
    expect(taskSchema.safeParse({ ...canonicalTask, source: null }).success).toBe(false);
    expect(completeTaskInputSchema.safeParse({ completed: false }).success).toBe(false);
    expect(cancelTaskInputSchema.safeParse({ cancelled: false }).success).toBe(false);
    expect(completeTaskInputSchema.parse({ expectedRevision: 1 })).toEqual({ expectedRevision: 1 });
    expect(cancelTaskInputSchema.parse({ expectedRevision: 1 })).toEqual({ expectedRevision: 1 });
    expect(reopenTaskInputSchema.parse({ expectedRevision: 1 })).toEqual({ expectedRevision: 1 });
    expect(reopenTaskInputSchema.safeParse({ completed: false }).success).toBe(false);
    expect(
      taskMovePreviewSchema.safeParse({
        destinationListId: listId,
        destinationListRevision: 3,
        destinationProjectId: projectId,
        destinationProjectRevision: null,
        detachedProjectId: null,
        previewToken: "task-move-preview",
        sourceListId: listId,
        sourceListRevision: 2,
        sourceProjectId: null,
        taskId: id,
        taskRevision: 4,
      }).success,
    ).toBe(false);
    expect(
      taskMovePreviewSchema.safeParse({
        destinationListId: listId,
        destinationListRevision: 3,
        destinationProjectId: null,
        destinationProjectRevision: 5,
        detachedProjectId: projectId,
        previewToken: "task-move-preview",
        sourceListId: listId,
        sourceListRevision: 2,
        sourceProjectId: projectId,
        taskId: id,
        taskRevision: 4,
      }).success,
    ).toBe(false);
    const conflictDetails = {
      currentRevisions: { destinationList: 3, project: null, sourceList: 2, task: null },
      openContentCounts: { projects: 1, tasks: 2 },
    };
    expect(
      taskListArchiveConflictSchema.parse({
        ...conflictDetails,
        code: "task_list_has_active_contents",
        resolutions: ["move_active_contents", "archive_contents_together", "cancel"],
      }).resolutions,
    ).toEqual(["move_active_contents", "archive_contents_together", "cancel"]);
    expect(
      taskListArchiveConflictSchema.safeParse({
        ...conflictDetails,
        code: "unexpected_conflict",
        resolutions: ["move_active_contents", "archive_contents_together", "cancel"],
      }).success,
    ).toBe(false);
    expect(
      taskOrganizationConflictSchema.safeParse({
        ...conflictDetails,
        code: "unexpected_conflict",
        resolutions: ["move_active_contents"],
      }).success,
    ).toBe(false);
    expect(
      taskProjectCompletionConflictSchema.parse({
        ...conflictDetails,
        code: "task_project_has_open_tasks",
        resolutions: [
          "complete_open_tasks",
          "cancel_open_tasks",
          "move_open_tasks",
          "keep_project_open",
        ],
      }).resolutions,
    ).toEqual(["complete_open_tasks", "cancel_open_tasks", "move_open_tasks", "keep_project_open"]);
    expect(
      taskProjectCompletionConflictSchema.safeParse({
        ...conflictDetails,
        code: "task_project_has_open_tasks",
        resolutions: ["complete_open_tasks", "complete_open_tasks"],
      }).success,
    ).toBe(false);
    expect(
      taskListArchiveConflictSchema.safeParse({
        ...conflictDetails,
        code: "task_list_has_active_contents",
        resolutions: ["move_active_contents", "move_active_contents", "cancel"],
      }).success,
    ).toBe(false);
    expect(
      taskListQuerySchema.parse({ lifecycle: "open", listId, projectId, view: "today" }),
    ).toMatchObject({
      lifecycle: "open",
      listId,
      projectId,
      view: "today",
    });
  });

  it("parses calendar and event values and rejects invalid chronology", () => {
    expect(calendarProviderSchema.parse("local")).toBe("local");
    expect(
      createLocalCalendarInputSchema.parse({ name: "Personal", timezone: "UTC" }).color,
    ).toBeNull();
    expect(updateLocalCalendarInputSchema.safeParse({}).success).toBe(false);
    expect(updateLocalCalendarInputSchema.parse({ name: "Work" })).toEqual({ name: "Work" });
    expect(
      calendarSchema.parse({
        id,
        accountId,
        provider: "local",
        name: "Personal",
        color: null,
        timezone: "UTC",
        isPrimary: true,
        isSelected: true,
        isWritable: true,
        lastSyncedAt: null,
      }).name,
    ).toBe("Personal");
    const input = { calendarId: id, title: "Focus", startsAt: start, endsAt: end, timezone: "UTC" };
    expect(createEventInputSchema.parse(input)).toMatchObject({
      allDay: false,
      notes: null,
      location: null,
    });
    expect(createEventInputSchema.safeParse({ ...input, endsAt: start }).success).toBe(false);
    expect(
      createEventInputSchema.safeParse({ ...input, timezone: "Definitely/Not_A_Time_Zone" })
        .success,
    ).toBe(false);
    expect(updateEventInputSchema.safeParse({}).success).toBe(false);
    expect(
      updateEventInputSchema.safeParse({
        expectedBlockUpdatedAtById: {},
        expectedUpdatedAt: start,
      }).success,
    ).toBe(false);
    expect(updateEventInputSchema.safeParse({ startsAt: end, endsAt: start }).success).toBe(false);
    expect(updateEventInputSchema.parse({ startsAt: start })).toEqual({ startsAt: start });
    expect(
      updateEventInputSchema.parse({
        expectedBlockUpdatedAtById: { [accountId]: start },
        expectedUpdatedAt: start,
        title: "Revised focus",
      }),
    ).toEqual({
      expectedBlockUpdatedAtById: { [accountId]: start },
      expectedUpdatedAt: start,
      title: "Revised focus",
    });
    expect(createEventBlockInputSchema.parse({ calendarId: id })).toEqual({
      calendarId: id,
      mode: "busy",
    });
    expect(updateEventBlockInputSchema.parse({ mode: "details" })).toEqual({ mode: "details" });
    const candidate = {
      allDay: false,
      buffer: { afterMinutes: 15, beforeMinutes: 15 },
      calendarId: id,
      endsAt: end,
      evidence: {
        kind: "ticket",
        source: {
          accountId,
          provider: "google",
          remoteId: "ticket-1",
          revision: "v1",
          sourceType: "mail_thread",
        },
        summary: "Confirmed ticket.",
      },
      flexibility: "hard",
      location: null,
      notes: null,
      startsAt: start,
      timezone: "UTC",
      title: "Train",
      visibility: "private",
    };
    expect(calendarCommitmentCandidateSchema.parse(candidate)).toMatchObject(candidate);
    expect(
      calendarCommitmentCandidateSchema.safeParse({ ...candidate, endsAt: start }).success,
    ).toBe(false);
    expect(previewCalendarCommitmentInputSchema.parse({ candidate }).requestedPolicy).toBe(
      "preview",
    );
    expect(
      calendarProfilePreferencesSchema.parse({
        afterBufferMinutes: 15,
        automaticEventCreation: false,
        automaticEventEvidence: ["ticket", "booking"],
        beforeBufferMinutes: 15,
        busyBlockPrivacy: "busy",
        defaultCalendarId: id,
        defaultTimezone: "UTC",
      }).defaultCalendarId,
    ).toBe(id);
    expect(
      calendarProfilePreferencesSchema.safeParse({
        afterBufferMinutes: 15,
        automaticEventCreation: false,
        automaticEventEvidence: ["ticket"],
        beforeBufferMinutes: 15,
        busyBlockPrivacy: "busy",
        defaultCalendarId: id,
        defaultTimezone: "Eastern",
      }).success,
    ).toBe(false);
    expect(createGoalInputSchema.parse({ title: "Protect focus" })).toMatchObject({
      progress: 0,
      description: null,
      targetDate: null,
    });
    expect(updateGoalInputSchema.safeParse({}).success).toBe(false);
    expect(createMotiveInputSchema.parse({ title: "Act with care" })).toMatchObject({
      detail: null,
    });
    expect(updateMotiveInputSchema.safeParse({}).success).toBe(false);
    expect(
      eventListQuerySchema.parse({ from: start, to: end, calendarIds: `${id},`, query: "focus" })
        .calendarIds,
    ).toEqual([id]);
    expect(
      calendarEventSchema.parse({
        ...input,
        id: accountId,
        provider: "local",
        remoteEventId: null,
        status: "confirmed",
        recurrence: [],
        createdAt: start,
        updatedAt: start,
      }),
    ).toMatchObject({ blockMode: null, blocks: [], blockSourceEventId: null, title: "Focus" });
    expect(
      calendarEventSchema.safeParse({
        ...input,
        endsAt: start,
        id: accountId,
        provider: "local",
        remoteEventId: null,
        status: "confirmed",
        recurrence: [],
        createdAt: start,
        updatedAt: start,
      }).success,
    ).toBe(false);
  });

  it("parses mail, mailbox, and iCloud connector values", () => {
    expect(mailProviderSchema.parse("icloud")).toBe("icloud");
    expect(mailboxRoleSchema.parse("inbox")).toBe("inbox");
    expect(
      mailboxSchema.parse({
        accountId,
        id,
        name: "Inbox",
        provider: "google",
        role: "inbox",
        totalCount: 10,
        unreadCount: 2,
      }).unreadCount,
    ).toBe(2);
    expect(
      mailThreadSchema.parse({
        accountId,
        bodyText: "Hello",
        from: { address: "sender@example.com", name: null },
        id,
        mailboxIds: [id],
        messageCount: 1,
        provider: "google",
        receivedAt: start,
        remoteThreadId: "remote",
        snippet: "Hello",
        starred: false,
        subject: "Subject",
        to: [],
        unread: true,
        updatedAt: start,
      }).subject,
    ).toBe("Subject");
    expect(
      updateMailThreadInputSchema.parse({
        expectedUpdatedAt: start,
        unread: false,
      }),
    ).toEqual({ expectedUpdatedAt: start, unread: false });
    expect(updateMailThreadInputSchema.safeParse({ expectedUpdatedAt: start }).success).toBe(false);
    expect(
      bulkUpdateMailInputSchema.parse({
        items: [{ expectedUpdatedAt: start, id }],
        unread: false,
      }),
    ).toEqual({
      items: [{ expectedUpdatedAt: start, id }],
      unread: false,
    });
    expect(
      bulkUpdateMailInputSchema.safeParse({
        items: [
          { expectedUpdatedAt: start, id },
          { expectedUpdatedAt: "2026-07-28T12:00:00.000Z", id },
        ],
        starred: true,
      }).success,
    ).toBe(false);
    expect(
      mailListQuerySchema.parse({
        accountIds: `${accountId},`,
        limit: "25",
        mailboxId: id,
        query: "sender",
        unread: "true",
      }),
    ).toMatchObject({ accountIds: [accountId], limit: 25, unread: true });
    expect(mailListQuerySchema.parse({ unread: "false" }).unread).toBe(false);
    expect(mailListQuerySchema.parse({ snoozed: "true", starred: "true" })).toMatchObject({
      snoozed: true,
      starred: true,
    });
    expect(
      connectICloudInputSchema.parse({
        appSpecificPassword: "xxxx-xxxx",
        email: "APPLE@ICLOUD.COM",
      }),
    ).toEqual({
      appSpecificPassword: "xxxx-xxxx",
      calendar: true,
      email: "apple@icloud.com",
      mail: true,
    });
    expect(
      connectICloudInputSchema.safeParse({
        appSpecificPassword: "password",
        calendar: false,
        email: "apple@icloud.com",
        mail: false,
      }).success,
    ).toBe(false);
  });
});

describe("finance agent contracts", () => {
  it("uses percentage points for recurring-change preferences", () => {
    expect(
      financeGuidedPreferencesSchema.parse({
        recurringAmountChangePercent: 20,
      }).recurringAmountChangePercent,
    ).toBe(20);
    expect(
      financeGuidedPreferencesSchema.safeParse({
        recurringAmountChangePercent: 101,
      }).success,
    ).toBe(false);
    expect(
      financeGuidedPreferencesSchema.safeParse({
        futurePreference: "x".repeat(501),
      }).success,
    ).toBe(false);
    expect(
      financeGuidedPreferencesSchema.parse({
        futureNullablePreference: null,
      }),
    ).toMatchObject({ futureNullablePreference: null });
    expect(
      financeGuidedPreferencesSchema.safeParse({
        largeExpenseAlertAmount: 500,
      }).success,
    ).toBe(false);
    expect(
      financeGuidedPreferencesSchema.parse({
        largeExpenseAlertAmount: 500,
        lowBalanceAlertAmount: 100,
        planningCurrency: "USD",
      }),
    ).toMatchObject({ planningCurrency: "USD" });
  });

  it("requires one revision-guarded decision per transaction", () => {
    const decision = {
      categoryId: accountId,
      confidence: 0.95,
      expectedTransactionUpdatedAt: start,
      learnMerchant: "suggest" as const,
      rationale: "The user accepted this proposal.",
      transactionId: id,
    };
    expect(
      applyFinanceCategorizationsInputSchema.safeParse({ decisions: [decision] }).success,
    ).toBe(true);
    expect(
      applyFinanceCategorizationsInputSchema.safeParse({
        decisions: [decision, decision],
      }).success,
    ).toBe(false);
  });

  it("parses explicit Finance pending query booleans without truthy string coercion", () => {
    expect(financeTransactionQuerySchema.parse({ pending: "false" }).pending).toBe(false);
    expect(financeTransactionQuerySchema.parse({ pending: "true" }).pending).toBe(true);
  });
});

describe("time-zone ranges", () => {
  it("calculates local dates, day ranges, date shifts, and weekday weeks", () => {
    const now = new Date("2026-07-13T16:00:00.000Z");
    expect(localDateAt(now, "America/New_York")).toEqual({ day: 13, month: 7, year: 2026 });
    expect(localDayRange(now, "America/New_York")).toEqual({
      from: "2026-07-13T04:00:00.000Z",
      to: "2026-07-14T04:00:00.000Z",
    });
    expect(
      localDateTimeToUtc({ day: 13, month: 7, year: 2026 }, 9 * 60, "America/New_York"),
    ).toEqual(new Date("2026-07-13T13:00:00.000Z"));
    expect(localWeekRange(now, "America/New_York")).toEqual({
      from: "2026-07-12T04:00:00.000Z",
      to: "2026-07-19T04:00:00.000Z",
    });
    expect(
      localDateRange(
        { day: 1, month: 11, year: 2026 },
        { day: 2, month: 11, year: 2026 },
        "America/New_York",
      ),
    ).toEqual({
      from: "2026-11-01T04:00:00.000Z",
      to: "2026-11-02T05:00:00.000Z",
    });
    expect(addLocalDays({ day: 31, month: 12, year: 2026 }, 1)).toEqual({
      day: 1,
      month: 1,
      year: 2027,
    });
  });

  it("starts Sunday dates on Sunday and follows DST", () => {
    expect(localWeekRange(new Date("2026-07-19T16:00:00Z"), "UTC")).toEqual({
      from: "2026-07-19T00:00:00.000Z",
      to: "2026-07-26T00:00:00.000Z",
    });
    expect(localDayRange(new Date("2026-03-08T16:00:00Z"), "America/New_York")).toEqual({
      from: "2026-03-08T05:00:00.000Z",
      to: "2026-03-09T04:00:00.000Z",
    });
  });
});

describe("connected account health", () => {
  it("parses retrying account health with automatic recovery", () => {
    expect(
      connectedAccountHealthSchema.parse({
        message: "Google is temporarily unavailable. ilo will retry automatically.",
        nextSyncAt: "2026-08-05T20:05:00.000Z",
        recovery: "automatic",
        state: "retrying",
      }),
    ).toMatchObject({ state: "retrying", recovery: "automatic" });
  });

  it("rejects provider-sized health messages", () => {
    expect(
      connectedAccountHealthSchema.safeParse({
        message: "x".repeat(301),
        nextSyncAt: null,
        recovery: "operator",
        state: "service_attention",
      }).success,
    ).toBe(false);
  });
});

describe("connector authorization outcomes", () => {
  it("keeps only the provider-neutral browser outcome", () => {
    expect(
      connectorAuthorizationOutcomeSchema.parse({
        accountId: null,
        code: "authorization-code-canary",
        email: "person@example.com",
        provider: "google",
        providerMessage: "provider-message-canary",
        requestId: "request-canary",
        retryable: true,
        scope: "scope-canary",
        state: "state-canary",
        status: "failed",
      }),
    ).toEqual({
      accountId: null,
      provider: "google",
      retryable: true,
      status: "failed",
    });
  });

  it("rejects identities outside the closed connector outcome contract", () => {
    expect(
      connectorAuthorizationOutcomeSchema.safeParse({
        accountId: "not-a-uuid",
        provider: "icloud",
        retryable: false,
        status: "connected",
      }).success,
    ).toBe(false);
  });
});

describe("connector notification contracts", () => {
  it("keeps subscription lifecycle and trigger reasons closed", async () => {
    const {
      connectorSubscriptionKindSchema,
      connectorSubscriptionStatusSchema,
      connectorSyncTriggerReasonSchema,
    } = await import("./connection.js");
    expect(connectorSubscriptionKindSchema.options).toEqual([
      "gmail_mailbox",
      "google_calendar_list",
      "google_calendar_events",
      "icloud_mail_idle",
    ]);
    expect(connectorSubscriptionStatusSchema.options).toEqual([
      "pending",
      "active",
      "renewing",
      "expired",
      "failed",
      "stopped",
    ]);
    expect(connectorSyncTriggerReasonSchema.options).toEqual([
      "initial",
      "notification",
      "reconciliation",
      "manual",
      "retry",
      "recovery",
    ]);
  });
});
