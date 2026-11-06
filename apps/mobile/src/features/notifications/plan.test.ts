import type { TaskWorkspaceItem } from "@personal-os/domain";
import { describe, expect, it } from "vitest";
import { alertTarget, notificationChanges, planAlerts } from "./plan";

const now = Date.parse("2026-11-06T12:00:00Z");
function task(id = "a", dueAt = "2026-11-06T13:00:00Z"): TaskWorkspaceItem {
  return {
    kind: "task",
    deletedAt: null,
    readOnly: false,
    record: { id, dueAt, lifecycle: "open" },
  } as TaskWorkspaceItem;
}
describe("device due alerts", () => {
  it("ignores overdue, invalid, completed, deleted and read-only records", () => {
    const a = task();
    expect(
      planAlerts(
        "owner",
        [
          task("past", "2026-11-05T00:00:00Z"),
          task("invalid", "invalid"),
          { ...a, readOnly: true },
          { ...a, deletedAt: "2026-11-06T10:00:00Z" },
          { ...a, record: { ...a.record, lifecycle: "completed" } } as TaskWorkspaceItem,
        ],
        now,
      ),
    ).toEqual([]);
  });
  it("keeps task and reminder identity distinct, deduplicates, sorts and caps", () => {
    const reminder = {
      kind: "reminder",
      deletedAt: null,
      readOnly: false,
      record: { id: "a", dueAt: "2026-11-06T12:30:00Z", completedAt: null },
    } as TaskWorkspaceItem;
    const result = planAlerts("owner", [task(), task(), reminder], now);
    expect(result.map((row) => row.kind)).toEqual(["reminder", "task"]);
    expect(planAlerts("owner", [task(), reminder], now, 1)).toEqual([result[0]]);
    expect(
      planAlerts(
        "owner",
        [
          {
            ...reminder,
            record: { ...reminder.record, completedAt: "2026-11-06T12:01:00Z" },
          } as TaskWorkspaceItem,
        ],
        now,
      ),
    ).toEqual([]);
  });
  it("does not reschedule unchanged alerts and cancels completed items without touching other features", () => {
    const desired = planAlerts("owner", [task()], now);
    const existing = [
      { identifier: desired[0].identifier, dueAt: desired[0].dueAt },
      { identifier: "another-feature" },
    ];
    expect(notificationChanges(desired, existing)).toEqual({ cancel: [], schedule: [] });
    expect(notificationChanges([], existing)).toEqual({
      cancel: [desired[0].identifier],
      schedule: [],
    });
  });
  it("replaces changed dates and old-owner schedules", () => {
    const old = planAlerts("owner", [task()], now)[0];
    const next = planAlerts("owner", [task("a", "2026-11-06T15:00:00Z")], now);
    expect(notificationChanges(next, [old])).toEqual({ cancel: [old.identifier], schedule: next });
    const other = planAlerts("other", [task()], now);
    expect(notificationChanges(other, [old])).toEqual({
      cancel: [old.identifier],
      schedule: other,
    });
  });
  it("rejects foreign, signed-out and malformed notification destinations", () => {
    const alert = planAlerts("owner", [task()], now)[0];
    expect(alertTarget(alert, "owner")).toEqual({ id: "a", kind: "task" });
    expect(alertTarget(alert, null)).toBeNull();
    expect(alertTarget(alert, "other")).toBeNull();
    expect(alertTarget({ ...alert, id: "../settings" }, "owner")).toBeNull();
    expect(alertTarget({ ...alert, kind: "settings" }, "owner")).toBeNull();
  });
});
