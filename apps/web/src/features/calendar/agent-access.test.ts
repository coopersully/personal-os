import type { Calendar } from "@personal-os/domain";
import { calendarAgentAccessReadiness } from "./agent-access.js";

describe("Calendar agent access readiness", () => {
  it("uses singular recovery guidance for one source error", () => {
    const calendar = {
      isSelected: true,
      isWritable: true,
      source: { syncStatus: "error" },
    } as unknown as Calendar;

    expect(
      calendarAgentAccessReadiness({
        calendars: { data: [calendar], state: "ready" },
        hosts: { data: [], state: "ready" },
        profile: { data: undefined, state: "ready" },
      })[0]?.description,
    ).toContain("1 needs reconnect");
    expect(
      calendarAgentAccessReadiness({
        calendars: { data: [calendar, calendar], state: "ready" },
        hosts: { data: [], state: "ready" },
        profile: { data: undefined, state: "ready" },
      })[0]?.description,
    ).toContain("2 need reconnect");
  });
});
