import { type Goal, type Motive, updateGoalInputSchema } from "@personal-os/domain";
import { describe, expect, it } from "vitest";
import { goalChanges, motiveChanges, personalDraft } from "./logic";

const goal: Goal = {
  id: "goal",
  title: "Swim",
  description: "Practice",
  targetDate: "2026-12-01",
  progress: 30,
  status: "active",
  createdAt: "2026-11-10T00:00:00Z",
  updatedAt: "2026-11-10T00:00:00Z",
};
describe("personal record patches", () => {
  it("only sends changed fields, preserving independently edited server fields", () => {
    expect(goalChanges({ ...personalDraft(goal), title: "Swim daily" }, goal)).toEqual({
      title: "Swim daily",
    });
  });
  it("couples completion and reopening to progress", () => {
    expect(goalChanges({ ...personalDraft(goal), progress: "100" }, goal)).toEqual({
      progress: 100,
      status: "completed",
    });
    const completed = { ...goal, status: "completed" as const, progress: 100 };
    expect(goalChanges({ ...personalDraft(completed), progress: "80" }, completed)).toEqual({
      progress: 80,
      status: "active",
    });
  });
  it("preserves pause, clears nullable fields, rejects invalid progress", () => {
    expect(
      goalChanges({ ...personalDraft(goal), active: false, detail: "", targetDate: "" }, goal),
    ).toEqual({ status: "paused", description: null, targetDate: null });
    expect(
      updateGoalInputSchema.safeParse(
        goalChanges({ ...personalDraft(goal), progress: "101" }, goal),
      ).success,
    ).toBe(false);
  });
  it("keeps motives distinct from goals and allows pause", () => {
    const motive: Motive = {
      id: "motive",
      title: "Family",
      detail: null,
      isActive: true,
      createdAt: goal.createdAt,
      updatedAt: goal.updatedAt,
    };
    expect(motiveChanges({ ...personalDraft(motive), active: false }, motive)).toEqual({
      isActive: false,
    });
  });
});
