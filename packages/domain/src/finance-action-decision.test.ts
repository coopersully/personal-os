import { describe, expect, it } from "vitest";
import { decideFinanceAction } from "./finance-action-decision.js";

describe("financial permission, information and approval decisions", () => {
  for (const bypass of [false, true]) {
    for (const mutation of [false, true]) {
      it.each([
        "sufficient",
        "missing",
        "conflicting",
      ] as const)(`denies absent permission before %s information (bypass=${bypass}, mutation=${mutation})`, (information) => {
        expect(decideFinanceAction({ permitted: false, bypass, mutation, information })).toBe(
          "deny",
        );
      });
      it.each([
        "missing",
        "conflicting",
      ] as const)(`asks about %s information even when authorized (bypass=${bypass}, mutation=${mutation})`, (information) => {
        expect(decideFinanceAction({ permitted: true, bypass, mutation, information })).toBe("ask");
      });
    }
    it(`permits grounded reads or faithful nonfinancial knowledge capture (bypass=${bypass})`, () => {
      expect(
        decideFinanceAction({
          permitted: true,
          mutation: false,
          bypass,
          information: "sufficient",
        }),
      ).toBe("execute");
    });
  }
  it("proposes every authorized grounded financial mutation with bypass off", () => {
    expect(
      decideFinanceAction({
        permitted: true,
        mutation: true,
        bypass: false,
        information: "sufficient",
      }),
    ).toBe("propose");
  });
  it("executes authorized grounded financial work with bypass on", () => {
    expect(
      decideFinanceAction({
        permitted: true,
        mutation: true,
        bypass: true,
        information: "sufficient",
      }),
    ).toBe("execute");
  });
});
