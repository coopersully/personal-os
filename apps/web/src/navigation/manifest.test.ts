import { describe, expect, it } from "vitest";
import {
  navigationOwnerForLocation,
  rendersApplicationShell,
  workspaceDefinitions,
} from "./manifest.js";

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
    expect(navigationOwnerForLocation("/reviews")).toEqual({
      kind: "workspace",
      workspace: "today",
    });
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
});
