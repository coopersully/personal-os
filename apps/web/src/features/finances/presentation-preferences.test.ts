// @vitest-environment jsdom
import { workspacePreferencesSchema } from "@personal-os/domain";
import { describe, expect, it } from "vitest";
import { financePresentationParams } from "./presentation-preferences";

describe("Finance display defaults", () => {
  const saved = workspacePreferencesSchema.parse({
    financeTransactionView: "cards",
    financeTransactionGroup: "merchant",
  });
  it("restores saved choices on a plain Transactions link", () => {
    expect(Object.fromEntries(financePresentationParams(new URLSearchParams(), saved))).toEqual({
      view: "cards",
      group: "merchant",
    });
  });
  it("preserves explicit defaults and unrelated filters without changing saved choices", () => {
    const params = financePresentationParams(
      new URLSearchParams("view=table&group=none&categoryId=travel"),
      saved,
    );
    expect(Object.fromEntries(params)).toEqual({
      view: "table",
      group: "none",
      categoryId: "travel",
    });
    expect(saved.financeTransactionGroup).toBe("merchant");
  });
  it("keeps the saved card grouping when a link selects table view", () => {
    expect(
      Object.fromEntries(financePresentationParams(new URLSearchParams("view=table"), saved)),
    ).toEqual({ view: "table", group: "merchant" });
  });
  it("uses the existing defaults for an account without preferences", () => {
    expect(Object.fromEntries(financePresentationParams(new URLSearchParams()))).toEqual({
      view: "table",
      group: "none",
    });
  });
});
