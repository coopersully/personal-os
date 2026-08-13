import {
  auditAttentionItemMetadata,
  auditDomainProfileMetadata,
  auditMailRuleMetadata,
  auditSnapshot,
  domainProfileChangedFields,
  mailRuleChangedFields,
  serializeEvent,
  serializeTask,
  serializeTaskList,
  serializeTaskProject,
  serializeUser,
} from "./serialization.js";

describe("auditSnapshot", () => {
  it("keeps operational identifiers while removing private content and credentials", () => {
    expect(
      auditSnapshot({
        id: "event-1",
        nested: { bodyText: "private email", refreshToken: "refresh-secret" },
        notes: "private note",
        status: "active",
        summary: "Private attention summary",
        title: "Private appointment",
      }),
    ).toEqual({
      id: "event-1",
      nested: { bodyText: "[redacted]", refreshToken: "[redacted]" },
      notes: "[redacted]",
      status: "active",
      summary: "[redacted]",
      title: "[redacted]",
    });
  });

  it("preserves lifecycle metadata while rejecting noncanonical Task material", () => {
    const timestamp = new Date("2026-08-13T04:00:00.000Z");
    expect(() =>
      serializeTask({
        taskLifecycle: null,
        taskListId: "list-1",
        taskRevision: 1,
      } as Parameters<typeof serializeTask>[0]),
    ).toThrow("Cannot serialize a Task without canonical lifecycle, List, and revision.");
    expect(
      serializeTaskList({
        archivedAt: null,
        availability: "archived",
        color: null,
        createdAt: timestamp,
        deletedAt: timestamp,
        description: null,
        id: "list-1",
        kind: "standard",
        name: "Archived work",
        revision: 2,
        updatedAt: timestamp,
      } as Parameters<typeof serializeTaskList>[0]),
    ).toMatchObject({ deletedAt: timestamp.toISOString(), source: { revision: "2" } });
    expect(
      serializeTaskProject({
        archivedAt: timestamp,
        availability: "archived",
        cancelledAt: null,
        completedAt: null,
        createdAt: timestamp,
        deletedAt: timestamp,
        id: "project-1",
        lifecycle: "open",
        listId: "list-1",
        name: "Archived outcome",
        notes: null,
        revision: 3,
        targetDate: null,
        updatedAt: timestamp,
        why: null,
      } as Parameters<typeof serializeTaskProject>[0]),
    ).toMatchObject({ deletedAt: timestamp.toISOString(), source: { revision: "3" } });
  });

  it("serializes completed setup and local Event identity from durable local IDs", () => {
    const timestamp = new Date("2026-08-13T04:00:00.000Z");
    expect(
      serializeUser({
        accentColor: null,
        createdAt: timestamp,
        displayName: "Coverage User",
        email: "coverage@example.com",
        emailVerifiedAt: null,
        homeLocation: null,
        id: "user-1",
        planningTimezone: "UTC",
        setupCompletedAt: timestamp,
        setupCurrentStep: null,
        setupDismissedAt: null,
        setupSelectedWorkspaces: [],
        setupStartedAt: timestamp,
        setupStatus: "completed",
        theme: "system",
        updatedAt: timestamp,
        workdayEndMinute: 1020,
        workdayStartMinute: 540,
      } as Parameters<typeof serializeUser>[0]),
    ).toMatchObject({ setup: { completedAt: timestamp.toISOString() } });
    const localEvent = {
      allDay: false,
      attendees: [],
      blockMode: "none",
      blockSourceEventId: null,
      calendarId: "calendar-1",
      conferenceUrl: null,
      createdAt: timestamp,
      endsAt: timestamp,
      eventType: "default",
      id: "event-1",
      location: null,
      notes: null,
      provider: "local",
      recurrence: null,
      reminders: [],
      remoteEtag: null,
      remoteEventId: null,
      startsAt: timestamp,
      status: "confirmed",
      timezone: "UTC",
      title: "Local event",
      transparency: "opaque",
      updatedAt: timestamp,
      visibility: "default",
    } as Parameters<typeof serializeEvent>[0];
    expect(serializeEvent(localEvent)).toMatchObject({
      source: { provider: "local", remoteId: "event-1" },
    });
    expect(serializeEvent({ ...localEvent, provider: "google" })).toMatchObject({
      source: { provider: "google", remoteId: null },
    });
  });

  it("reduces Mail rules to content- and topology-safe metadata", () => {
    const before = {
      actions: [{ afterDays: 0, mailboxId: "mailbox-secret", type: "add_label" }],
      condition: { field: "sender", operator: "contains", value: "private@example.com" },
      description: "Private sender workflow",
      enabled: false,
      legacyAction: "archive",
      name: "Private name",
      policy: "preview",
      profileId: "profile-secret",
      sourceAccountIds: ["account-secret"],
      version: 1,
    };
    const after = { ...before, enabled: true, policy: "approved_rule", version: 2 };
    const changedFields = mailRuleChangedFields(before, after);
    const metadata = auditMailRuleMetadata(after, changedFields);

    expect(metadata).toEqual({
      actionCount: 1,
      actionTypes: ["add_label"],
      changedFields: ["enabled", "policy"],
      conditionField: "sender",
      conditionOperator: "contains",
      enabled: true,
      policy: "approved_rule",
      sourceCount: 1,
      version: 2,
    });
    expect(JSON.stringify(metadata)).not.toMatch(
      /private@example\.com|mailbox-secret|account-secret|profile-secret|Private/,
    );
    expect(auditMailRuleMetadata(null, ["enabled"])).toBeNull();
    expect(
      auditMailRuleMetadata(
        {
          actions: null,
          condition: null,
          enabled: false,
          legacyAction: "archive",
          policy: "preview",
          sourceAccountIds: [],
          version: 1,
        },
        [],
      ),
    ).toMatchObject({
      actionTypes: ["archive"],
      conditionField: "any",
      conditionOperator: "contains",
    });
  });

  it("reduces shared profile and attention records to scope-safe accountability metadata", () => {
    const before = {
      categories: [],
      domain: "mail",
      instructions: ["Keep order mail for one day."],
      objective: "Private inbox objective",
      preferences: { retentionDays: 1 },
      sourceContexts: [
        {
          notes: "Private source notes",
          sourceId: "account-secret-id",
          sourceLabel: "Personal",
        },
      ],
      status: "draft",
      summary: "Private profile summary",
      version: 1,
    };
    const after = {
      ...before,
      objective: "Another private objective",
      status: "active",
      version: 2,
    };
    const changedFields = domainProfileChangedFields(before, after);

    expect(auditDomainProfileMetadata(after, changedFields)).toEqual({
      categoryCount: 0,
      changedFields: ["objective", "status"],
      domain: "mail",
      instructionCount: 1,
      preferenceCount: 1,
      sourceCount: 1,
      status: "active",
      version: 2,
    });
    expect(
      auditAttentionItemMetadata({
        domain: "mail",
        importance: "high",
        kind: "follow_up",
        relatedEntityType: "mail_thread",
        status: "open",
        version: 3,
      }),
    ).toEqual({
      domain: "mail",
      importance: "high",
      kind: "follow_up",
      relatedEntityType: "mail_thread",
      status: "open",
      version: 3,
    });
  });
});
