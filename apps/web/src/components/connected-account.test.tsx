// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { ConnectedAccount } from "./connected-account";

it("distinguishes same-name accounts by service and email and keeps fallback identity", () => {
  const { container } = render(
    <>
      <ConnectedAccount
        account={{ label: "Sam Example", provider: "google", email: "sam@example.com" }}
      />
      <ConnectedAccount
        account={{ label: "Sam Example", provider: "icloud", email: "sam@icloud.test" }}
      />
    </>,
  );
  expect(screen.getAllByText("Sam Example")).toHaveLength(2);
  expect(screen.getByText("Google · sam@example.com")).toBeVisible();
  expect(screen.getByText("iCloud · sam@icloud.test")).toBeVisible();
  expect(container.querySelectorAll(".connected-account-visual__service svg")).toHaveLength(2);
  expect(screen.getAllByText("SE")).toHaveLength(2);
});

it("keeps a usable identity when the profile photo cannot load", () => {
  const { container } = render(
    <ConnectedAccount
      account={{
        label: "Sam Example",
        provider: "google",
        avatarUrl: "https://example.com/unavailable.png",
      }}
    />,
  );
  expect(screen.getByText("SE")).toBeVisible();
  expect(screen.getByText("Sam Example")).toBeVisible();
  expect(container.querySelector(".connected-account-visual__service")).toBeVisible();
});

it("uses email or service when the display name is absent and a monogram for unknown services", () => {
  const { rerender, container } = render(
    <ConnectedAccount account={{ label: "", email: "sam@example.com", provider: "google" }} />,
  );
  expect(screen.getByText("sam@example.com")).toBeVisible();
  rerender(<ConnectedAccount account={{ label: "", provider: "Example service" }} />);
  expect(screen.getByText("Example service", { selector: ".account-profile__name" })).toBeVisible();
  expect(container.querySelector("[data-brand-monogram]")).toHaveTextContent("E");
});

it("preserves astral characters in missing-photo initials", () => {
  render(<ConnectedAccount account={{ label: "🪐 Example", provider: "google" }} />);
  expect(screen.getByText("🪐E")).toBeVisible();
});
