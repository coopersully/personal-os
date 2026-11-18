import { expect, it } from "vitest";
import { financeGroupIcon, financeGroupIconSchema } from "./appearance.js";

it.each([
  ["Groceries", "groceries"],
  ["Dining out", "dining"],
  ["Apartment rent", "home"],
  ["Essentials", "home"],
  ["Lifestyle", "lifestyle"],
  ["Travel", "travel"],
  ["Car insurance", "transport"],
  ["Subscriptions", "subscriptions"],
  ["Other spending", "uncategorized"],
])("assigns a meaningful icon for %s without a user decision", (label, expected) => {
  expect(financeGroupIcon(label)).toBe(expected);
  expect(financeGroupIconSchema.safeParse(expected).success).toBe(true);
});
it("retains safe generic fallbacks for unfamiliar names", () => {
  expect(financeGroupIcon("My custom envelope", "bucket")).toBe("bucket");
  expect(financeGroupIconSchema.safeParse("<svg />").success).toBe(false);
});
