import { type FinanceAccount, getDefaultWorkspacePreferences } from "@personal-os/domain";
import { selectedFinanceAccounts } from "./account-preferences";

const accounts = [
  { id: "cash", kind: "cash" },
  { id: "investment", kind: "investment" },
] as FinanceAccount[];
it("follows eligible accounts until a selection is explicit and never includes missing accounts", () => {
  expect(selectedFinanceAccounts(accounts, "cash")).toEqual(["cash"]);
  expect(selectedFinanceAccounts(accounts, "investments")).toEqual(["investment"]);
  const preferences = getDefaultWorkspacePreferences("finances");
  expect(selectedFinanceAccounts(accounts, "spend", preferences)).toEqual(["cash", "investment"]);
  expect(
    selectedFinanceAccounts(accounts, "spend", { ...preferences, spendAccountIds: [] }),
  ).toEqual([]);
  expect(
    selectedFinanceAccounts(accounts, "spend", {
      ...preferences,
      spendAccountIds: ["missing", "cash"],
    }),
  ).toEqual(["cash"]);
});
