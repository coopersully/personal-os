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
      financeTransactionGroup: "none",
      spendAccountIds: null,
      cashAccountIds: null,
      investmentAccountIds: null,
    });
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
