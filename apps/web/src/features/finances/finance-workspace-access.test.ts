import { describe, expect, it } from "vitest";
import {
  financeRouteNeedsSetup,
  financeSetupTask,
  safeFinanceReturnTo,
} from "./finance-workspace-access";

describe("Finance setup navigation", () => {
  it("retains local Finance destinations and rejects external paths and loops", () => {
    expect(safeFinanceReturnTo("/finances/spending?from=2026-10-01#details")).toBe(
      "/finances/spending?from=2026-10-01#details",
    );
    for (const path of [
      null,
      "//evil.test/finances",
      "https://evil.test/finances",
      "/finances-other",
      "/finances/setup?returnTo=/finances",
      "/finances/%73etup",
      "/finances/../settings",
      "/finances/\\evil",
      "/finances/%2f%2fevil",
      "/finances/%00",
      "/finances/ invalid",
      "/finances/%",
    ])
      expect(safeFinanceReturnTo(path)).toBe("/finances");
  });
  it("scopes navigation task markers to their own route", () => {
    expect(financeSetupTask("/finances/transactions", "?financeTask=correct")).toBe("correct");
    expect(financeSetupTask("/finances/transactions", "?financeTask=import")).toBe("import");
    expect(financeSetupTask("/finances/plan", "?financeTask=approve")).toBe("approve");
    for (const path of ["/finances", "/finances/spending", "/finances/wealth"])
      expect(financeRouteNeedsSetup(path, "?financeTask=correct")).toBe(true);
    expect(financeRouteNeedsSetup("/finances/transactions", "")).toBe(true);
    expect(financeRouteNeedsSetup("/finances/plan", "")).toBe(true);
    for (const section of [
      "setup",
      "accounts",
      "chat",
      "automations",
      "activity",
      "review",
      "reviews/abc",
      "exports",
      "health",
    ])
      expect(financeRouteNeedsSetup("/finances/" + section, "")).toBe(false);
  });
});
