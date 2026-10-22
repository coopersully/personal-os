import { describe, expect, it } from "vitest";
import { createFinanceAccountInputSchema } from "../finance.js";

const base = {
  name: "Travel cash",
  institution: "Personal records",
  provider: "manual",
  balance: 20,
};
describe("explicit manual account currency", () => {
  it.each([
    "USD",
    "EUR",
    "JPY",
    null,
    undefined,
  ])("preserves the stated currency %s without guessing", (currencyCode) => {
    const parsed = createFinanceAccountInputSchema.parse({
      ...base,
      ...(currencyCode === undefined ? {} : { currencyCode }),
    });
    expect(parsed.currencyCode ?? null).toBe(currencyCode ?? null);
  });
  it.each(["usd", "US", "USDD", "$", "US1", ""])("rejects malformed currency %s", (currencyCode) =>
    expect(createFinanceAccountInputSchema.safeParse({ ...base, currencyCode }).success).toBe(
      false,
    ));
});
