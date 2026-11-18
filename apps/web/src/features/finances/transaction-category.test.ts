import type { FinanceCategory, FinanceTransaction } from "@personal-os/domain";
import {
  financeTransactionCategoryLabel,
  groupFinanceTransactionsByCategory,
} from "./transaction-category";

const categories = [{ id: "food", name: "Meals & groceries" }] as FinanceCategory[];
it("resolves ID-only and conflicting legacy records from the owner taxonomy", () => {
  expect(
    financeTransactionCategoryLabel({ categoryId: "food", category: null }, categories, "ready"),
  ).toBe("Meals & groceries");
  expect(
    financeTransactionCategoryLabel(
      { categoryId: "food", category: "GENERAL_MERCHANDISE" },
      categories,
      "ready",
    ),
  ).toBe("Meals & groceries");
});
it("distinguishes loading or missing taxonomy from uncategorized without trusting stale legacy text", () => {
  for (const category of [null, "FOOD_AND_DRINK"]) {
    expect(
      financeTransactionCategoryLabel({ categoryId: "missing", category }, [], "loading"),
    ).toBe("Loading category…");
    for (const state of ["ready", "unavailable"] as const)
      expect(financeTransactionCategoryLabel({ categoryId: "missing", category }, [], state)).toBe(
        "Category unavailable",
      );
  }
});
it("keeps no-ID legacy and provider fallback without requiring taxonomy", () => {
  expect(
    financeTransactionCategoryLabel(
      { categoryId: null, category: "FOOD_AND_DRINK" },
      [],
      "loading",
    ),
  ).toBe("Food & Drink");
  expect(
    financeTransactionCategoryLabel(
      { categoryId: null, category: "custom_category" },
      [],
      "unavailable",
    ),
  ).toBe("Custom Category");
  expect(financeTransactionCategoryLabel({ categoryId: null, category: null }, [], "ready")).toBe(
    "Uncategorized",
  );
});
it("groups canonical IDs consistently and keeps native source records unchanged", () => {
  const first = {
    id: "one",
    categoryId: "food",
    category: null,
    amount: 18.5,
  } as FinanceTransaction;
  const second = {
    id: "two",
    categoryId: "food",
    category: "GENERAL_MERCHANDISE",
    amount: 27,
  } as FinanceTransaction;
  const groups = groupFinanceTransactionsByCategory([first, second], categories, "ready");
  expect(groups).toEqual([{ label: "Meals & groceries", items: [first, second] }]);
  expect(groups[0]?.items[0]).toBe(first);
  expect(first.category).toBeNull();
  expect(second.category).toBe("GENERAL_MERCHANDISE");
});
