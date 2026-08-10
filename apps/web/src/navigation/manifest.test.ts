import { describe, expect, it } from "vitest";
import { navigationOwnerForLocation, workspaceDefinitions } from "./manifest.js";

describe("workspace navigation ownership", () => {
  it("assigns every route family to a workspace or the account utility", () => {
    expect(navigationOwnerForLocation("/goals")).toEqual({
      kind: "workspace",
      workspace: "today",
    });
    expect(navigationOwnerForLocation("/motives")).toEqual({
      kind: "workspace",
      workspace: "today",
    });
    expect(navigationOwnerForLocation("/activity")).toEqual({
      kind: "workspace",
      workspace: "today",
    });
    expect(navigationOwnerForLocation("/reminders")).toEqual({
      kind: "workspace",
      workspace: "tasks",
    });
    expect(navigationOwnerForLocation("/settings")).toEqual({ kind: "account-utility" });
    expect(navigationOwnerForLocation("/setup")).toEqual({ kind: "account-utility" });
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
});
