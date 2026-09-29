import {
  currentRitualWindow,
  type RitualOccurrence,
  type RitualStep,
  requiresSnoozeConfirmation,
  ritualAnswerIsValid,
  ritualDefinitionInputSchema,
  ritualIsAnswered,
  ritualStepSchema,
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
