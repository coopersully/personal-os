import { localDateAt } from "@personal-os/domain";
import { describe, expect, it } from "vitest";
import { qaEveningAgendaStart } from "./qa-fixtures.js";

const timezone = "America/New_York";

describe("demo evening agenda", () => {
  it.each([
    ["2026-10-26T16:00:00Z", "2026-10-27T01:00:00Z"],
    ["2026-10-27T01:00:00Z", "2026-10-27T01:15:00Z"],
    ["2026-10-27T03:40:00Z", "2026-10-27T03:30:00Z"],
    ["2026-10-27T03:59:00Z", "2026-10-27T03:30:00Z"],
    ["2026-11-02T04:59:00Z", "2026-11-02T04:30:00Z"],
  ])("keeps an unexpired event in Today when seeded at %s", (instant, expectedStart) => {
    const now = new Date(instant);
    const startsAt = qaEveningAgendaStart(now, timezone);
    const endsAt = new Date(startsAt.getTime() + 30 * 60_000);
    expect(startsAt.toISOString()).toBe(new Date(expectedStart).toISOString());
    expect(localDateAt(startsAt, timezone)).toEqual(localDateAt(now, timezone));
    expect(endsAt.getTime()).toBeGreaterThan(now.getTime());
  });
});
