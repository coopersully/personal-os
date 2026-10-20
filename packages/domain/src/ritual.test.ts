import {
  currentRitualWindow,
  type RitualOccurrence,
  type RitualStep,
  requiresSnoozeConfirmation,
  ritualAnswerIsValid,
  ritualDefinitionInputSchema,
  ritualIsAnswered,
  ritualStepSchema,
  ritualStreakCount,
  upcomingRitualWindows,
} from "./ritual.js";

const definition = (kind: "morning" | "night", time = kind === "morning" ? "06:00" : "21:00") => ({
  id: kind,
  kind,
  title: kind,
  enabled: true,
  time,
  timeZone: "America/New_York",
  revision: 1,
  enabledAt: "2026-01-01T00:00:00Z",
  steps: [{ id: "teeth", label: "Brush teeth", kind: "checkbox" as const }],
});
describe("ritual schedule", () => {
  it.each([
    ["2026-09-29T09:59:00Z", "night"],
    ["2026-09-29T10:00:00Z", "morning"],
    ["2026-09-30T00:59:00Z", "morning"],
    ["2026-09-30T01:00:00Z", "night"],
  ])("selects one current boundary at %s", (now, kind) =>
    expect(currentRitualWindow([definition("morning"), definition("night")], now)?.ritualId).toBe(
      kind,
    ));
  it("expires a lone ritual at its next occurrence", () =>
    expect(currentRitualWindow([definition("morning")], "2026-09-29T12:00:00Z")?.expiresAt).toBe(
      "2026-09-30T10:00:00.000Z",
    ));
  it("returns nothing when disabled or not yet enabled", () => {
    expect(
      currentRitualWindow([{ ...definition("morning"), enabled: false }], "2026-09-29T12:00:00Z"),
    ).toBeNull();
    expect(
      currentRitualWindow(
        [{ ...definition("morning"), enabledAt: "2026-09-30T00:00:00Z" }],
        "2026-09-29T12:00:00Z",
      ),
    ).toBeNull();
  });
  it("uses first valid time after the DST gap", () =>
    expect(
      currentRitualWindow([definition("morning", "02:30")], "2026-03-08T08:00:00Z")?.dueAt,
    ).toBe("2026-03-08T07:00:00.000Z"));
  it("uses the earlier repeated wall time", () =>
    expect(
      currentRitualWindow([definition("morning", "01:30")], "2026-11-01T07:00:00Z")?.dueAt,
    ).toBe("2026-11-01T05:30:00.000Z"));
  it("validates settings and thresholds", () => {
    expect([0, 1, 2, 3].map(requiresSnoozeConfirmation)).toEqual([false, false, true, true]);
    expect(
      ritualDefinitionInputSchema.safeParse({
        ...definition("morning"),
        requestId: crypto.randomUUID(),
        expectedRevision: 0,
        deviceId: "test",
      }).success,
    ).toBe(true);
    expect(
      ritualDefinitionInputSchema.safeParse({ ...definition("morning"), time: "25:00" }).success,
    ).toBe(false);
  });
  it("prepares seven days of stable offline boundaries", () => {
    const windows = upcomingRitualWindows(
      [definition("morning"), definition("night")],
      "2026-09-29T12:00:00Z",
    );
    expect(windows).toHaveLength(14);
    expect(windows[0]?.dueAt).toBe("2026-09-30T01:00:00.000Z");
    expect(windows.every((w) => w.expiresAt > w.dueAt)).toBe(true);
  });
});

describe("ritual answers", () => {
  it.each([
    ["checkbox", true, true],
    ["checkbox", false, false],
    ["checkbox", "true", false],
    ["short_text", "Today was good", true],
    ["short_text", " ", false],
    ["short_text", true, false],
    ["time", "06:30", true],
    ["time", "23:59", true],
    ["time", "24:00", false],
    ["time", "6:30", false],
    ["date", "2024-02-29", true],
    ["date", "2026-02-29", false],
    ["date", "2026-13-01", false],
    ["date", "2026-2-01", false],
    ["number", "0", true],
    ["number", "-1.25", true],
    ["number", ".5", true],
    ["number", "1e3", true],
    ["number", "NaN", false],
    ["number", "Infinity", false],
    ["number", "0xff", false],
    ["number", "1e999", false],
    ["multiple_choice", "Good", true],
    ["multiple_choice", "Unknown", false],
  ] as const)("validates %s answer %s", (kind, value, valid) => {
    expect(
      ritualAnswerIsValid({ id: "one", label: "Answer", kind, options: ["Good", "Okay"] }, value),
    ).toBe(valid);
  });
  it("requires distinct choices and rejects missing or insufficient choices", () => {
    const step = { id: "mood", label: "Mood", kind: "multiple_choice" };
    for (const options of [undefined, [], ["Good"], ["Good", "Good"], ["Good", " Good "]]) {
      expect(ritualStepSchema.safeParse({ ...step, options }).success).toBe(false);
    }
    expect(ritualStepSchema.safeParse({ ...step, options: ["Good", "Okay"] }).success).toBe(true);
    expect(ritualAnswerIsValid(step as RitualStep, "Good")).toBe(false);
  });
  it("requires the latest answer to each step to be valid and submitted", () => {
    const occurrence = {
      definition: definition("morning"),
      responses: [],
    } as unknown as RitualOccurrence;
    expect(ritualIsAnswered(occurrence)).toBe(false);
    const response = {
      id: "r",
      requestId: "r",
      stepId: "teeth",
      value: true,
      submitted: false,
      observedAt: "",
      recordedAt: "",
    };
    occurrence.responses.push(response);
    expect(ritualIsAnswered(occurrence)).toBe(false);
    occurrence.responses.push({ ...response, submitted: true });
    expect(ritualIsAnswered(occurrence)).toBe(true);
    occurrence.responses.push({ ...response, submitted: true, value: false });
    expect(ritualIsAnswered(occurrence)).toBe(false);
  });
});

it("step identifiers support Unicode and spaces without unsafe path characters", () => {
  for (const id of ["wake time", "☀", "mood+today"]) {
    expect(ritualStepSchema.safeParse({ id, label: "Step", kind: "checkbox" }).success).toBe(true);
  }
  for (const id of [".", "..", "one/two", "one\\two", "%2F", "line\nfeed", "null\0byte"]) {
    expect(ritualStepSchema.safeParse({ id, label: "Step", kind: "checkbox" }).success).toBe(false);
  }
});

it("rejects long malformed numbers without overlapping digit matches", () => {
  expect(
    ritualAnswerIsValid({ id: "number", label: "Number", kind: "number" }, `${"0".repeat(5000)}x`),
  ).toBe(false);
});

it("a revised schedule cutoff excludes retroactive boundaries", () => {
  const morning = definition("morning");
  const evening = { ...definition("night", "11:00"), enabledAt: "2026-09-29T16:00:00Z" };
  expect(currentRitualWindow([morning, evening], "2026-09-29T16:00:00Z")?.ritualId).toBe("morning");
  const upcoming = upcomingRitualWindows([morning, evening], "2026-09-29T16:00:00Z");
  expect(upcoming[0]?.dueAt).toBe("2026-09-30T10:00:00.000Z");
  expect(upcoming.find((window) => window.ritualId === "night")?.dueAt).toBe(
    "2026-09-30T15:00:00.000Z",
  );
});

it("optional steps do not block completion, while legacy steps remain required", () => {
  const occurrence = {
    definition: {
      ...definition("morning"),
      steps: [{ id: "journal", label: "Journal", kind: "short_text", optional: true }],
    },
    responses: [],
  } as unknown as RitualOccurrence;
  expect(ritualIsAnswered(occurrence)).toBe(true);
  occurrence.definition.steps.push({ id: "teeth", label: "Teeth", kind: "checkbox" });
  expect(ritualIsAnswered(occurrence)).toBe(false);
});

it("rejects empty, duplicate, and invalid custom weekdays", () => {
  for (const days of [[], [1, 1], [-1], [7], [1.5]]) {
    expect(
      ritualStepSchema.safeParse({ id: "one", label: "One", kind: "checkbox", days }).success,
    ).toBe(false);
  }
});

it("resolves selected days by the ritual's local date and preserves definitions", async () => {
  const { ritualDefinitionForDate } = await import("./ritual.js");
  const original = {
    ...definition("morning"),
    steps: [
      { id: "daily", label: "Daily", kind: "checkbox" as const },
      { id: "weekdays", label: "Weekdays", kind: "checkbox" as const, days: [1, 2, 3, 4, 5] },
      { id: "weekends", label: "Weekends", kind: "checkbox" as const, days: [0, 6] },
      { id: "tuesday", label: "Tuesday", kind: "checkbox" as const, days: [2] },
    ],
  };
  expect(ritualDefinitionForDate(original, "2026-10-17").steps.map((s) => s.id)).toEqual([
    "daily",
    "weekends",
  ]);
  expect(ritualDefinitionForDate(original, "2026-10-20").steps.map((s) => s.id)).toEqual([
    "daily",
    "weekdays",
    "tuesday",
  ]);
  expect(original.steps).toHaveLength(4);
});

it("resolves reminder times across midnight and daylight saving changes", async () => {
  const { nextRitualReminderAt, defaultRitualReminderTime } = await import("./ritual.js");
  expect(defaultRitualReminderTime(definition("morning"))).toBe("12:00");
  expect(defaultRitualReminderTime(definition("night"))).toBe("22:00");
  expect(defaultRitualReminderTime({ ...definition("night"), reminderTime: "23:00" })).toBe(
    "23:00",
  );
  expect(nextRitualReminderAt(definition("night"), "22:00", "2026-10-18T03:00:00Z")).toBe(
    "2026-10-19T02:00:00.000Z",
  );
  expect(nextRitualReminderAt(definition("morning"), "02:30", "2026-03-08T05:00:00Z")).toBe(
    "2026-03-08T07:00:00.000Z",
  );
  expect(nextRitualReminderAt(definition("morning"), "01:30", "2026-11-01T04:00:00Z")).toBe(
    "2026-11-01T05:30:00.000Z",
  );
  expect(nextRitualReminderAt(definition("night"), "25:00", "2026-10-18T03:00:00Z")).toBeNull();
});

describe("ritual streaks", () => {
  const history = (dates: string[], status: RitualOccurrence["status"] = "completed") =>
    dates.map((scheduledLocalDate) => ({ scheduledLocalDate, status, hasSteps: true }));
  it("counts beyond a week and leaves today's pending ritual open", () => {
    const entries = history(
      Array.from({ length: 12 }, (_, i) => `2026-10-${String(i + 1).padStart(2, "0")}`),
    );
    expect(
      ritualStreakCount(
        definition("morning"),
        { scheduledLocalDate: "2026-10-13", status: "pending" },
        entries,
      ),
    ).toBe(12);
  });
  it.each(["skipped", "missed", "cancelled_configuration"] as const)("breaks on %s", (status) => {
    expect(
      ritualStreakCount(
        definition("morning"),
        { scheduledLocalDate: "2026-10-03", status: "pending" },
        [...history(["2026-10-01"]), ...history(["2026-10-02"], status)],
      ),
    ).toBe(0);
  });
  it("breaks at an unrecorded scheduled day", () => {
    expect(
      ritualStreakCount(
        definition("morning"),
        { scheduledLocalDate: "2026-10-03", status: "pending" },
        history(["2026-10-01"]),
      ),
    ).toBe(0);
  });
  it("ignores unscheduled weekend days and empty snapshots", () => {
    const def = definition("morning");
    const weekdays = {
      ...def,
      steps: def.steps.map((step) => ({ ...step, days: [1, 2, 3, 4, 5] })),
    };
    expect(
      ritualStreakCount(weekdays, { scheduledLocalDate: "2026-10-05", status: "completed" }, [
        ...history(["2026-10-02", "2026-10-05"]),
        { scheduledLocalDate: "2026-10-03", status: "completed", hasSteps: false },
      ]),
    ).toBe(2);
    expect(
      ritualStreakCount(def, { scheduledLocalDate: "2026-10-05", status: "pending" }, []),
    ).toBe(0);
  });
});
