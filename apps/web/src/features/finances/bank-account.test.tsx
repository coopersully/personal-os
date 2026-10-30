// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { BankAccount } from "./bank-account";

it("shows a bank identity with institution and reported subtype without invented card details", () => {
  const { container } = render(
    <BankAccount
      account={{
        name: "Everyday checking",
        institution: "Fixture Bank",
        kind: "cash",
        provider: "plaid",
        providerSubtype: "checking",
      }}
    />,
  );
  expect(screen.getByText("Everyday checking")).toBeVisible();
  expect(screen.getByText("Fixture Bank · Bank account · checking")).toBeVisible();
  expect(container.querySelector("[data-brand-monogram]")).toHaveTextContent("F");
  expect(screen.queryByText(/visa|mastercard|••••/i)).toBeNull();
});

it("identifies manually tracked accounts and falls back to financial kind", () => {
  render(
    <BankAccount
      account={{
        name: "Home loan",
        institution: "Fixture Bank",
        kind: "debt",
        provider: "manual",
        providerSubtype: null,
      }}
    />,
  );
  expect(screen.getByText("Fixture Bank · Debt account · Manually tracked")).toBeVisible();
});
