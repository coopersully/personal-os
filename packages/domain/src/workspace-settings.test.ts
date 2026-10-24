import { describe, expect, it } from "vitest";
import {
  getDefaultWorkspacePreferences,
  resolveWorkspaceSettings,
  workspacePreferenceSchemas,
  workspaceSettingsSchema,
  workspaceSettingsUpdateSchemas,
} from "./workspace-settings.js";

describe("workspace settings contracts", () => {
  it("resolves only the owning workspace's defaults", () => {
    expect(getDefaultWorkspacePreferences("mail")).toEqual({
      includeArchivedInSearch: true,
      mailConversationLayout: "split",
      mailListDensity: "comfortable",
      mailListWidth: 34,
    });
    expect(getDefaultWorkspacePreferences("finances")).toEqual({
      includeArchivedInSearch: true,
      financeTransactionView: "table",
      financeManualVisibility: "auto",
      financeSpendingView: "list",
      financeSpendingGrouping: "auto",
      financeSpendingIncludePending: true,
      financeSpendingIncludeUncategorized: true,
      financeSpendingBasis: "personal_cost",
      financeSpendingSubtractRefunds: true,
      financeSpendingPeriod: "week",
      financeTransactionGroup: "none",
      spendAccountIds: null,
      cashAccountIds: null,
      investmentAccountIds: null,
    });
    expect(
      resolveWorkspaceSettings("finances", { financeSpendingView: "bubbles" }).preferences
        .financeSpendingView,
    ).toBe("bubbles");
    expect(getDefaultWorkspacePreferences("calendar")).toMatchObject({
      weekStartsOn: "sunday",
      defaultEventDurationMinutes: 60,
    });
    expect(getDefaultWorkspacePreferences("tasks")).toMatchObject({
      defaultCaptureListId: null,
      showCompletedTasks: false,
    });
  });
  it("rejects fields owned by another workspace and keeps PATCH omission distinct from defaults", () => {
    expect(
      workspaceSettingsUpdateSchemas.mail.safeParse({
        expectedRevision: 0,
        preferences: { calendarView: "day" },
      }).success,
    ).toBe(false);
    expect(
      workspaceSettingsUpdateSchemas.tasks.parse({
        expectedRevision: 1,
        preferences: { taskGroup: "date" },
      }).preferences,
    ).toEqual({ taskGroup: "date" });
    expect(
      workspaceSettingsSchema.safeParse({
        workspace: "mail",
        revision: 0,
        preferences: getDefaultWorkspacePreferences("calendar"),
      }).success,
    ).toBe(false);
  });
  it("reads legacy repeated row details without changing their meaning", () => {
    expect(
      resolveWorkspaceSettings("tasks", { revision: 2, taskRowDetails: ["estimate", "estimate"] })
        .preferences.taskRowDetails,
    ).toEqual(["estimate"]);
  });
  it("preserves explicit empty selections, rejects duplicate sets and invalid durations", () => {
    expect(
      workspacePreferenceSchemas.finances.parse({ spendAccountIds: [] }).spendAccountIds,
    ).toEqual([]);
    expect(
      workspacePreferenceSchemas.tasks.safeParse({ taskRowDetails: ["estimate", "estimate"] })
        .success,
    ).toBe(false);
    expect(
      workspacePreferenceSchemas.calendar.safeParse({ defaultEventDurationMinutes: 0 }).success,
    ).toBe(false);
  });
});

it("adds Spending defaults without resetting existing account/transaction preferences or PATCH omissions", () => {
  const legacy = resolveWorkspaceSettings("finances", {
    revision: 7,
    spendAccountIds: [],
    financeTransactionView: "cards",
    financeTransactionGroup: "category",
  });
  expect(legacy.preferences).toMatchObject({
    spendAccountIds: [],
    financeTransactionView: "cards",
    financeTransactionGroup: "category",
    financeSpendingView: "list",
    financeSpendingGrouping: "auto",
    financeSpendingIncludePending: true,
  });
  const update = workspaceSettingsUpdateSchemas.finances.parse({
    expectedRevision: 7,
    preferences: { financeSpendingIncludePending: false },
  });
  expect(update.preferences).toEqual({ financeSpendingIncludePending: false });
  expect(
    workspaceSettingsUpdateSchemas.finances.safeParse({
      expectedRevision: 7,
      preferences: { financeSpendingView: "rhythm" },
    }).success,
  ).toBe(true);
});

it("preserves explicit manual visibility with revisioned omitted-field updates", () => {
  const settings = resolveWorkspaceSettings("finances", {
    revision: 3,
    financeManualVisibility: "hide",
    spendAccountIds: [],
  });
  expect(settings.preferences.financeManualVisibility).toBe("hide");
  expect(
    workspaceSettingsUpdateSchemas.finances.parse({
      expectedRevision: 3,
      preferences: { financeSpendingView: "rhythm" },
    }).preferences,
  ).toEqual({ financeSpendingView: "rhythm" });
  expect(
    workspaceSettingsUpdateSchemas.finances.parse({
      expectedRevision: 3,
      preferences: { financeManualVisibility: "show" },
    }).preferences,
  ).toEqual({ financeManualVisibility: "show" });
});
