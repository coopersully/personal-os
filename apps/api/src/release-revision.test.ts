import { describe, expect, it } from "vitest";
import { readinessPayload } from "./release-revision.js";

describe("public readiness provenance", () => {
  it("includes only an exact archived commit, never local configuration", () => {
    expect(readinessPayload("a".repeat(40))).toEqual({ status: "ready", revision: "a".repeat(40) });
    for (const value of [
      "",
      "unknown",
      "A".repeat(40),
      "a".repeat(39),
      "a".repeat(41),
      "secret=value",
    ]) {
      expect(readinessPayload(value)).toEqual({ status: "ready" });
    }
    expect(readinessPayload()).toEqual({ status: "ready" });
  });
});
