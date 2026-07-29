import {
  auditAttentionItemMetadata,
  auditDomainProfileMetadata,
  auditMailRuleMetadata,
  auditSnapshot,
  domainProfileChangedFields,
  mailRuleChangedFields,
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
