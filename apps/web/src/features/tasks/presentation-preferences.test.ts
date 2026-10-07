// @vitest-environment jsdom
import { workspacePreferencesSchema } from "@personal-os/domain";
import { describe, expect, it } from "vitest";
import { taskPresentationParams } from "./presentation-preferences";

describe("Tasks display defaults", () => {
  const saved = workspacePreferencesSchema.parse({
    taskSort: "title",
    taskGroup: "project",
    taskRowDetails: [],
    taskContainerSort: "name",
  });
  it("restores saved options including no row details", () => {
    const params = taskPresentationParams(new URLSearchParams(), saved);
    expect(Object.fromEntries(params)).toEqual({
      sort: "title",
      group: "project",
      details: "none",
      containerSort: "name",
    });
  });
  it("preserves explicit link values, including default choices", () => {
    const params = taskPresentationParams(
      new URLSearchParams("sort=default&group=none&details=estimate&view=today"),
      saved,
    );
    expect(params.get("sort")).toBe("default");
    expect(params.get("group")).toBe("none");
    expect(params.get("details")).toBe("estimate");
    expect(params.get("view")).toBe("today");
  });
  it("preserves existing defaults for accounts with no saved settings", () => {
    expect(Object.fromEntries(taskPresentationParams(new URLSearchParams()))).toEqual({
      sort: "default",
      group: "none",
      details: "estimate",
      containerSort: "updated",
    });
  });
});
