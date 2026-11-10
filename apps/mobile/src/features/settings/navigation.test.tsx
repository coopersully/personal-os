import { describe, expect, it } from "vitest";
import { workspacePages } from "../../navigation/workspace-pages";
import {
  findSettingsDestination,
  searchSettings,
  settingsDestinations,
  settingsPath,
  workspaceSettingsPath,
} from "./navigation";

describe("native Settings navigation", () => {
  const available = settingsDestinations.map((destination) => destination.id);
  it("resolves every planned destination to a stable detail route", () => {
    expect(new Set(available).size).toBe(15);
    for (const destination of settingsDestinations) {
      expect(findSettingsDestination(destination.id)).toBe(destination);
      expect(settingsPath(destination.id)).toBe(`/settings/${destination.id}`);
    }
    expect(findSettingsDestination("unknown")).toBeUndefined();
  });
  it("searches labels and field keywords without mutating records or registry", () => {
    const before = JSON.stringify(settingsDestinations);
    expect(searchSettings("  TIMEZONE ", available).map((row) => row.id)).toEqual(["profile"]);
    expect(searchSettings("account email", available).map((row) => row.id)).toEqual(["profile"]);
    expect(searchSettings("unmatched", available)).toEqual([]);
    expect(JSON.stringify(settingsDestinations)).toBe(before);
  });
  it("hides unavailable destinations even when their keywords match", () => {
    expect(searchSettings("timezone", ["tasks"])).toEqual([]);
    expect(searchSettings("", ["tasks"]).map((row) => row.id)).toEqual(["tasks"]);
  });
  it("deep-links workspace entries and keeps Settings out of workspace tabs", () => {
    for (const workspace of ["tasks", "mail", "calendar", "finances"])
      expect(workspaceSettingsPath(workspace)).toBe(`/settings/${workspace}`);
    expect(workspaceSettingsPath("index")).toBe("/settings");
    expect(workspacePages).not.toHaveProperty("settings");
    expect(settingsPath("agents")).toBe("/settings/agents");
  });
});
