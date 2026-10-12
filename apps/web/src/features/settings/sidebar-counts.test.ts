// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { connectedAgentCount } from "./sidebar-counts";

describe("connected agent inventory count", () => {
  it("excludes unused, expired, and revoked credentials", () => {
    const active = { lastUsedAt: "2026-09-30T00:00:00Z", revokedAt: null, expiresAt: null };
    expect(
      connectedAgentCount(
        [
          active,
          { ...active, lastUsedAt: null },
          { ...active, revokedAt: "2026-10-01T00:00:00Z" },
          { ...active, expiresAt: "2026-10-01T00:00:00Z" },
          { ...active, expiresAt: "2026-10-02T00:00:00Z" },
        ],
        [{ id: "host" }],
        Date.parse("2026-10-01T00:00:00Z"),
      ),
    ).toBe(3);
    expect(connectedAgentCount([], [], Date.now())).toBe(0);
  });
});
