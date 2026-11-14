import type { TaskWorkspaceItem } from "@personal-os/domain";
import { describe, expect, it } from "vitest";
import {
  activeFilters,
  formatTargetDate,
  matchingOptions,
  partitionPinned,
  taskMetadata,
} from "./presentation";
import { buildViewOptions } from "./view-options";

describe("task presentation", () => {
  it("formats a project target as a calendar date and leaves unreadable values alone", () => {
    const expected = new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC",
    }).format(new Date(Date.UTC(2026, 11, 1)));
    expect(formatTargetDate("2026-12-01")).toBe(expected);
    expect(formatTargetDate("2026-12-01T00:00:00.000Z")).toBe(expected);
    expect(formatTargetDate("2026-12-01")).not.toContain("2026-12-01");
    expect(formatTargetDate("soon")).toBe("soon");
  });
  it("keeps routine metadata quiet while retaining urgency and read-only status", () => {
    const item = {
      kind: "task",
      readOnly: false,
      record: {
        priority: "medium",
        dueAt: null,
        notes: "Long notes",
        tags: ["tag"],
        estimateMinutes: 50,
      },
    } as unknown as TaskWorkspaceItem;
    expect(taskMetadata(item)).toEqual([]);
    expect(
      taskMetadata({
        ...item,
        readOnly: true,
        record: { ...item.record, priority: "high" },
      } as TaskWorkspaceItem),
    ).toEqual(["Read-only", "High priority"]);
  });
  it("does not hide reminder identity", () => {
    expect(
      taskMetadata({
        kind: "reminder",
        readOnly: false,
        record: { priority: "low", dueAt: null },
      } as TaskWorkspaceItem),
    ).toEqual(["Reminder"]);
  });
  it("omits unset constraints but includes explicit sorting and tags", () => {
    expect(
      activeFilters({ priority: undefined, tag: "", due: "any", sort: "priority", group: "none" }),
    ).toEqual([
      ["sort", "priority"],
      ["group", "none"],
    ]);
  });
  it("searches names case-insensitively without changing option identities", () => {
    const options = [
      { value: "", label: "None" },
      { value: "a", label: "House projects" },
      { value: "b", label: "Work" },
    ];
    expect(matchingOptions(options, " HOUSE ")).toEqual([options[1]]);
    expect(matchingOptions(options, "missing")).toEqual([]);
    expect(matchingOptions(options, "")).toEqual(options);
  });
  it("keeps scoped container menus task-specific and retains current sort", () => {
    const choices = buildViewOptions({ listId: "list-a", sort: "title" });
    expect(choices.some((choice) => choice.key === "kind")).toBe(false);
    expect(choices.find((choice) => choice.key === "sort")?.value).toBe("title");
  });
});

describe("pinned container directories", () => {
  it("shows each container in exactly one section using its own pin namespace", () => {
    const rows = [
      { kind: "list" as const, record: { id: "same" } },
      { kind: "project" as const, record: { id: "same" } },
    ];
    expect(partitionPinned(rows, { pinnedListIds: ["same"], pinnedProjectIds: [] })).toEqual({
      pinned: [rows[0]],
      directory: [rows[1]],
    });
    expect(partitionPinned(rows, { pinnedListIds: ["same"], pinnedProjectIds: ["same"] })).toEqual({
      pinned: rows,
      directory: [],
    });
  });
  it("keeps the directory available before preferences load", () => {
    const rows = [{ kind: "list" as const, record: { id: "a" } }];
    expect(partitionPinned(rows)).toEqual({ pinned: [], directory: rows });
  });
});

it("renders task dates in the account zone across a midnight boundary", () => {
  const item = {
    kind: "task",
    readOnly: false,
    record: { priority: "medium", dueAt: "2026-11-06T00:30:00Z" },
  } as TaskWorkspaceItem;
  expect(taskMetadata(item, "America/Los_Angeles")).toEqual(["Due Nov 5, 4:30 PM"]);
  expect(taskMetadata(item, "Asia/Tokyo")).toEqual(["Due Nov 6, 9:30 AM"]);
});
