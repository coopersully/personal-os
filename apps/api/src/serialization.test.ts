import { auditSnapshot } from "./serialization.js";

describe("auditSnapshot", () => {
  it("keeps operational identifiers while removing private content and credentials", () => {
    expect(
      auditSnapshot({
        id: "event-1",
        nested: { bodyText: "private email", refreshToken: "refresh-secret" },
        notes: "private note",
        status: "active",
        title: "Private appointment",
      }),
    ).toEqual({
      id: "event-1",
      nested: { bodyText: "[redacted]", refreshToken: "[redacted]" },
      notes: "[redacted]",
      status: "active",
      title: "[redacted]",
    });
  });
});
