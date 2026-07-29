import { ConnectorError } from "@personal-os/connectors";
import {
  mailProfilePreferencesSchema,
  mailRuleActionNeedsDurableExecution,
  mailRuleActionsMatchRetentionPreferences,
} from "@personal-os/domain";
import {
  applyMailRuleActionToState,
  classifyMailRuleProviderFailure,
  durableMailRuleActionFingerprint,
  mailRuleActionIsApplied,
  strongestMailRuleProviderEffect,
} from "./mail-rule-work.js";

describe("durable Mail rule work helpers", () => {
  it("builds a stable identity from the complete action snapshot", () => {
    const action = { afterDays: 1, mailboxId: null, type: "trash" as const };
    expect(durableMailRuleActionFingerprint(action)).toBe(
      durableMailRuleActionFingerprint({ ...action }),
    );
    expect(durableMailRuleActionFingerprint(action)).not.toBe(
      durableMailRuleActionFingerprint({ ...action, afterDays: 2 }),
    );
  });

  it("recognizes and projects every durable action without permanent deletion", () => {
    const initial = {
      mailboxIds: ["INBOX", "UNREAD"],
      starred: false,
      unread: true,
    };
    const archived = applyMailRuleActionToState(
      { afterDays: 1, mailboxId: null, type: "archive" },
      initial,
      null,
    );
    expect(archived.mailboxIds).toEqual(["UNREAD"]);
    expect(
      mailRuleActionIsApplied({ afterDays: 1, mailboxId: null, type: "archive" }, archived, null),
    ).toBe(true);

    const trashed = applyMailRuleActionToState(
      { afterDays: 1, mailboxId: null, type: "trash" },
      initial,
      null,
    );
    expect(trashed.mailboxIds).toEqual(["UNREAD", "TRASH"]);
    expect(
      mailRuleActionIsApplied({ afterDays: 1, mailboxId: null, type: "trash" }, trashed, null),
    ).toBe(true);

    const labeled = applyMailRuleActionToState(
      {
        afterDays: 1,
        mailboxId: "11111111-1111-4111-8111-111111111111",
        type: "add_label",
      },
      initial,
      "Label_Orders",
    );
    expect(labeled.mailboxIds).toContain("Label_Orders");

    const read = applyMailRuleActionToState(
      { afterDays: 1, mailboxId: null, type: "mark_read" },
      initial,
      null,
    );
    expect(read).toMatchObject({ unread: false });
    expect(
      mailRuleActionIsApplied({ afterDays: 1, mailboxId: null, type: "mark_read" }, read, null),
    ).toBe(true);
    const starred = applyMailRuleActionToState(
      { afterDays: 1, mailboxId: null, type: "star" },
      initial,
      null,
    );
    expect(starred).toMatchObject({ starred: true });
    expect(
      mailRuleActionIsApplied({ afterDays: 1, mailboxId: null, type: "star" }, starred, null),
    ).toBe(true);
    expect(
      mailRuleActionIsApplied(
        {
          afterDays: 1,
          mailboxId: "11111111-1111-4111-8111-111111111111",
          type: "add_label",
        },
        labeled,
        "Label_Orders",
      ),
    ).toBe(true);
    for (const action of [
      { afterDays: 1, mailboxId: null, type: "archive" as const },
      { afterDays: 1, mailboxId: null, type: "trash" as const },
      { afterDays: 1, mailboxId: null, type: "mark_read" as const },
      { afterDays: 1, mailboxId: null, type: "star" as const },
      {
        afterDays: 1,
        mailboxId: "11111111-1111-4111-8111-111111111111",
        type: "add_label" as const,
      },
    ]) {
      expect(mailRuleActionIsApplied(action, initial, null)).toBe(false);
    }
  });

  it("classifies every provider failure without exposing provider messages", () => {
    expect(classifyMailRuleProviderFailure(new ConnectorError("secret", 429))).toMatchObject({
      code: "provider_rate_limited",
      disposition: "retry",
      effect: "rejected",
    });
    for (const status of [401, 403]) {
      expect(classifyMailRuleProviderFailure(new ConnectorError("secret", status))).toMatchObject({
        code: "provider_authorization_failed",
        disposition: "retry",
        effect: "rejected",
      });
    }
    expect(classifyMailRuleProviderFailure(new ConnectorError("secret", 404))).toMatchObject({
      code: "provider_source_missing",
      disposition: "failed",
      effect: "rejected",
    });
    expect(classifyMailRuleProviderFailure(new ConnectorError("secret", 400))).toMatchObject({
      code: "provider_rejected",
      disposition: "failed",
      effect: "rejected",
    });
    for (const error of [
      new ConnectorError("secret", 408),
      new ConnectorError("secret", 500),
      new Error("secret"),
    ]) {
      expect(classifyMailRuleProviderFailure(error)).toMatchObject({
        code: "provider_effect_indeterminate",
        disposition: "reconcile",
        effect: "indeterminate",
      });
      expect(classifyMailRuleProviderFailure(error).message).not.toContain("secret");
    }
  });

  it("never weakens known provider-effect evidence during recovery", () => {
    expect(strongestMailRuleProviderEffect(["none", "applied"], "indeterminate")).toBe("applied");
    expect(strongestMailRuleProviderEffect(["none", "indeterminate"], "rejected")).toBe(
      "indeterminate",
    );
    expect(strongestMailRuleProviderEffect(["none", "rejected"], "none")).toBe("rejected");
    expect(strongestMailRuleProviderEffect(["none"], "indeterminate")).toBe("indeterminate");
  });

  it("aligns durable routing and retention preferences for every action family", () => {
    expect(
      mailRuleActionNeedsDurableExecution({
        afterDays: 0,
        mailboxId: null,
        type: "mark_read",
      }),
    ).toBe(false);
    expect(
      mailRuleActionNeedsDurableExecution({ afterDays: 0, mailboxId: null, type: "archive" }),
    ).toBe(true);
    expect(
      mailRuleActionNeedsDurableExecution({ afterDays: 0, mailboxId: null, type: "trash" }),
    ).toBe(true);
    expect(
      mailRuleActionNeedsDurableExecution({ afterDays: 1, mailboxId: null, type: "star" }),
    ).toBe(true);

    const base = {
      importantEmailHandling: "inbox_only" as const,
      inboxStyle: "balanced" as const,
      noiseRetentionDays: null,
    };
    expect(
      mailRuleActionsMatchRetentionPreferences(
        [{ afterDays: 0, mailboxId: null, type: "archive" }],
        { ...base, noiseDisposition: "review_only" },
      ),
    ).toBe(true);
    expect(
      mailRuleActionsMatchRetentionPreferences(
        [{ afterDays: 2, mailboxId: null, type: "archive" }],
        {
          ...base,
          noiseDisposition: "archive_after_days",
          noiseRetentionDays: 2,
        },
      ),
    ).toBe(true);
    expect(
      mailRuleActionsMatchRetentionPreferences([{ afterDays: 2, mailboxId: null, type: "trash" }], {
        ...base,
        noiseDisposition: "trash_after_days",
        noiseRetentionDays: 1,
      }),
    ).toBe(false);

    expect(
      mailProfilePreferencesSchema.safeParse({
        ...base,
        noiseDisposition: "review_only",
        noiseRetentionDays: 1,
      }),
    ).toMatchObject({
      success: false,
    });
  });
});
