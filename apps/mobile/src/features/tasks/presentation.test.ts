import type { TaskWorkspaceItem } from "@personal-os/domain";
import { describe, expect, it } from "vitest";
import {
  activeFilters,
  formatEstimate,
  formatTargetDate,
  matchingOptions,
  partitionPinned,
  taskMetadata,
  taskRowDetails,
  taskRowSummary,
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

describe("task row details", () => {
  const item = {
    kind: "task",
    readOnly: false,
    record: {
      priority: "medium",
      dueAt: null,
      scheduledAt: "2026-11-06T00:30:00Z",
      notes: "  Bring the long ladder  ",
      tags: ["home", "errands"],
      estimateMinutes: 50,
    },
  } as unknown as TaskWorkspaceItem;
  it("always shows reserved time and the container, and nothing optional by default", () => {
    expect(taskRowDetails(item, { list: "Home", project: "Move" })).toEqual({
      context: ["Reserved Nov 6, 12:30 AM", "Home / Move"],
      notes: null,
      tags: [],
    });
    expect(
      taskRowDetails(item, { timezone: "America/Los_Angeles", project: "Move" }).context,
    ).toEqual(["Reserved Nov 5, 4:30 PM", "Move"]);
  });
  it("adds each saved detail on its own", () => {
    expect(taskRowDetails(item, { details: ["estimate"] })).toEqual({
      context: ["Reserved Nov 6, 12:30 AM", "50 min"],
      notes: null,
      tags: [],
    });
    expect(taskRowDetails(item, { details: ["notes"] }).notes).toBe("Bring the long ladder");
    expect(taskRowDetails(item, { details: ["tags"] }).tags).toEqual(["home", "errands"]);
  });
  it("renders nothing for a value the task does not have", () => {
    const bare = {
      ...item,
      record: { ...item.record, scheduledAt: null, notes: " ", tags: [], estimateMinutes: null },
    } as TaskWorkspaceItem;
    expect(taskRowDetails(bare, { details: ["estimate", "tags", "notes"] })).toEqual({
      context: [],
      notes: null,
      tags: [],
    });
  });
  it("keeps a reminder to its notes: it has no estimate, tags, container or reserved time", () => {
    const reminder = {
      kind: "reminder",
      readOnly: false,
      record: { priority: "low", dueAt: null, notes: "Call back" },
    } as TaskWorkspaceItem;
    expect(
      taskRowDetails(reminder, { details: ["estimate", "tags", "notes"], list: "Home" }),
    ).toEqual({ context: [], notes: "Call back", tags: [] });
  });
  it("formats an estimate in hours once it reaches one", () => {
    expect([45, 60, 90].map(formatEstimate)).toEqual(["45 min", "1 hr", "1 hr 30 min"]);
  });
  it("summarizes the row for assistive technology in reading order", () => {
    const shown = taskRowDetails(item, { details: ["estimate", "tags", "notes"], list: "Home" });
    expect(taskRowSummary(["High priority", "Due Nov 5, 4:30 PM"], shown, true)).toBe(
      "High priority, Overdue Nov 5, 4:30 PM, Reserved Nov 6, 12:30 AM, 50 min, Home, Bring the long ladder, Tags: home, errands",
    );
    expect(taskRowSummary([], taskRowDetails({ ...item, kind: "reminder" } as never))).toBe("");
  });
});
