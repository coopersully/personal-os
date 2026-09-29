import { describe, expect, it } from "vitest";
import { queryWindowFocusPolicy } from "./query-policy.js";

describe("queryWindowFocusPolicy", () => {
  it("keeps desktop forms mounted when the native window regains focus", () => {
    expect(queryWindowFocusPolicy(true)).toBe(false);
  });

  it("retains browser freshness behavior", () => {
    expect(queryWindowFocusPolicy(false)).toBe(true);
  });
});
