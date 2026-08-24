import { extractConferenceUrl } from "./types.js";

describe("extractConferenceUrl", () => {
  it("keeps recognized conference providers and ignores prose or unrelated links", () => {
    expect(extractConferenceUrl(null)).toBeNull();
    expect(
      extractConferenceUrl("Read https://example.com/first, then join https://zoom.us/j/12345."),
    ).toBe("https://zoom.us/j/12345");
    expect(extractConferenceUrl("Join https://subdomain.teams.microsoft.com/l/meetup-join")).toBe(
      "https://subdomain.teams.microsoft.com/l/meetup-join",
    );
    expect(extractConferenceUrl("Join https://meet.jit.si/ilo-demo")).toBe(
      "https://meet.jit.si/ilo-demo",
    );
    expect(extractConferenceUrl("Bad https://[not-a-host and ordinary text")).toBeNull();
  });
});
