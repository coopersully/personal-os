import { describe, expect, it } from "vitest";
import { queryWindowFocusPolicy } from "./query-policy.js";

describe("queryWindowFocusPolicy", () => {
  it("refreshes stale main desktop data when the native window regains focus", () => {
    expect(queryWindowFocusPolicy(true)).toBe(true);
  });

  it("isolates focus suppression to the desktop ritual webview", () => {
    expect(queryWindowFocusPolicy(true, "#ritual")).toBe(false);
    expect(queryWindowFocusPolicy(false, "#ritual")).toBe(true);
    expect(queryWindowFocusPolicy(true, "#settings")).toBe(true);
  });

  it("retains browser freshness behavior", () => {
    expect(queryWindowFocusPolicy(false)).toBe(true);
  });
});
