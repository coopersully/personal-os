import { describe, expect, it } from "vitest";
import { calendarNavigationItem } from "../features/calendar/manifest.js";
import { financesNavigationItem } from "../features/finances/manifest.js";
import { mailNavigationItem } from "../features/mail/manifest.js";
import { settingsNavigationItem } from "../features/settings/manifest.js";
import { tasksNavigationItem } from "../features/tasks/manifest.js";
import {
  navigationOwnerForLocation,
  rendersApplicationShell,
  workspaceDefinitions,
} from "./manifest.js";

describe("workspace navigation ownership", () => {
  it("assigns every route family to a workspace or the account utility", () => {
    expect(navigationOwnerForLocation("/goals")).toEqual({ kind: "account-utility" });
    expect(navigationOwnerForLocation("/motives")).toEqual({ kind: "account-utility" });
    expect(navigationOwnerForLocation("/activity")).toEqual({ kind: "account-utility" });
    expect(navigationOwnerForLocation("/reviews")).toEqual({ kind: "account-utility" });
    expect(navigationOwnerForLocation("/reminders")).toEqual({
      kind: "workspace",
      workspace: "tasks",
    });
    expect(navigationOwnerForLocation("/settings")).toEqual({ kind: "account-utility" });
    expect(navigationOwnerForLocation("/setup")).toEqual({ kind: "standalone-flow" });
  });

  it("keeps the account utility inside the shell and setup outside it", () => {
    expect(rendersApplicationShell(navigationOwnerForLocation("/settings"))).toBe(true);
    expect(rendersApplicationShell(navigationOwnerForLocation("/today"))).toBe(true);
    expect(rendersApplicationShell(navigationOwnerForLocation("/setup"))).toBe(false);
  });

  it("keeps the five workspace defaults in a stable order", () => {
    expect(workspaceDefinitions.map(({ id }) => id)).toEqual([
      "today",
      "calendar",
      "tasks",
      "mail",
      "finances",
    ]);
  });

  it("keeps feature-owned navigation metadata aligned with the shell manifest", () => {
    expect(calendarNavigationItem).toMatchObject({ label: "Calendar", path: "/calendar" });
    expect(tasksNavigationItem).toMatchObject({ label: "Tasks", path: "/tasks" });
    expect(mailNavigationItem).toMatchObject({ label: "Mail", path: "/mail" });
    expect(financesNavigationItem).toMatchObject({ label: "Finances", path: "/finances" });
    expect(settingsNavigationItem).toMatchObject({ label: "Settings", path: "/settings" });
  });
});
