// @vitest-environment jsdom
import { tasksWorkspacePreferencesSchema } from "@personal-os/domain";
import { describe, expect, it } from "vitest";
import { taskPresentationParams } from "./presentation-preferences";

describe("Tasks display defaults", () => {
  const saved = tasksWorkspacePreferencesSchema.parse({
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

it.each([
  "",
  "list=work",
  "project=launch",
  "view=all&list=work",
])("shows completed tasks by default in container %s", (scope) => {
  const saved = tasksWorkspacePreferencesSchema.parse({ showCompletedTasks: true });
  expect(taskPresentationParams(new URLSearchParams(scope), saved).get("status")).toBe(
    "open_and_completed",
  );
});
it.each([
  "view=history",
  "view=trash",
  "view=today",
  "view=upcoming",
  "view=all",
  "view=history&list=work",
])("keeps lifecycle/global view semantics for %s", (scope) => {
  const saved = tasksWorkspacePreferencesSchema.parse({ showCompletedTasks: true });
  expect(taskPresentationParams(new URLSearchParams(scope), saved).has("status")).toBe(false);
});
it.each([
  "open",
  "all",
  "completed",
  "cancelled",
])("preserves explicit status %s over saved visibility", (status) => {
  const saved = tasksWorkspacePreferencesSchema.parse({ showCompletedTasks: true });
  expect(taskPresentationParams(new URLSearchParams({ status }), saved).get("status")).toBe(status);
});
