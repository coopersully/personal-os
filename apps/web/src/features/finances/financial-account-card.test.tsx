// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import type { FinanceAccount } from "@personal-os/domain";
import { fireEvent, render, screen } from "@testing-library/react";
import { BankAccount } from "./bank-account";
import { FinancialAccountCard, institutionCardStyle } from "./financial-account-card";

const png =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/9ZkAAAAASUVORK5CYII=";
const account = {
  name: "Rewards Platinum",
  institution: "Fixture Bank",
  kind: "debt",
  provider: "plaid",
  providerSubtype: "credit card",
  providerType: "credit",
  balance: 123.45,
  currencyCode: "USD",
  accountMask: "1234",
  institutionBranding: { institutionId: "ins_1", logo: png, primaryColor: "#004466", url: null },
} as FinanceAccount;
it("renders real branding, known mask and balance in a full card", () => {
  const { container } = render(<FinancialAccountCard account={account} />);
  expect(container.querySelector('[data-slot="financial-account-card"]')).toHaveStyle({
    backgroundColor: "#004466",
    color: "#ffffff",
  });
  expect(screen.getByText("Rewards Platinum")).toBeVisible();
  expect(screen.getByText("•••• 1234")).toBeVisible();
  expect(screen.getByText("$123.45")).toBeVisible();
  expect(container.querySelector("img")).toHaveAttribute("src", png);
  expect(container.querySelector("img")).toHaveClass("size-full");
  expect(screen.queryByText(/visa|mastercard|valid thru/i)).toBeNull();
});
it("shares logos with compact identities and falls back on image failure", () => {
  const { container } = render(<BankAccount account={account} />);
  expect(container.querySelector(".account-preview")).not.toBeNull();
  const image = container.querySelector("img");
  expect(image).not.toBeNull();
  if (image) fireEvent.error(image);
  expect(container.querySelector("[data-brand-monogram]")).toHaveTextContent("F");
  expect(screen.getByText(/•••• 1234/)).toBeVisible();
});
it("uses safe theme fallback without invented digits or currency", () => {
  const { container } = render(
    <FinancialAccountCard
      account={{ ...account, accountMask: null, institutionBranding: null, currencyCode: null }}
    />,
  );
  expect(container.querySelector('[data-slot="financial-account-card"]')).not.toHaveAttribute(
    "style",
  );
  expect(container.textContent).not.toContain("••••");
  expect(container.textContent).not.toContain("$");
});
it("selects readable contrast and rejects CSS input", () => {
  expect(institutionCardStyle("#ffffff")).toEqual({ backgroundColor: "#ffffff", color: "#000000" });
  expect(institutionCardStyle("#000000")).toEqual({ backgroundColor: "#000000", color: "#ffffff" });
  expect(institutionCardStyle("url(https://evil.example)")).toBeUndefined();
});
