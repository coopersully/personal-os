// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { AccountAvatar } from "./account-avatar";

vi.mock("react", async () => {
  const { createRequire } = await import("node:module");
  return createRequire(`${process.cwd()}/package.json`)("react");
});
vi.mock("../../theme", () => ({ useTheme: () => ({ ink: "black", canvas: "white" }) }));
vi.mock("react-native", () => ({
  View: ({ children }: PropsWithChildren) => <div>{children}</div>,
  Text: ({ children }: PropsWithChildren) => <span>{children}</span>,
  Image: ({
    source,
    onError,
    accessibilityLabel,
  }: {
    source: { uri: string };
    onError: () => void;
    accessibilityLabel: string;
  }) => <img src={source.uri} alt={accessibilityLabel} onError={onError} />,
}));
afterEach(cleanup);
it("shows the supplied profile photo and falls back to initials on unavailable artwork", () => {
  const { rerender } = render(
    <AccountAvatar url="https://images.example.test/alex.jpg" name="Alex Morgan" />,
  );
  expect(screen.getByRole("img")).toHaveAttribute("src", "https://images.example.test/alex.jpg");
  fireEvent.error(screen.getByRole("img"));
  expect(screen.getByText("AM")).toBeVisible();
  rerender(<AccountAvatar url="https://images.example.test/new.jpg" name="Alex Morgan" />);
  expect(screen.getByRole("img")).toHaveAttribute("src", "https://images.example.test/new.jpg");
});
it("uses initials when the provider has no photo, without inventing an external avatar request", () => {
  render(<AccountAvatar name="Apple Personal" />);
  expect(screen.queryByRole("img")).toBeNull();
  expect(screen.getByText("AP")).toBeVisible();
});
