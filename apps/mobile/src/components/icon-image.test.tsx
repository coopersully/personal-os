// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { IconImage } from "./icon-image";

vi.mock("react", async () => {
  const { createRequire } = await import("node:module");
  return createRequire(`${process.cwd()}/package.json`)("react");
});
vi.mock("react-native", () => ({
  Image: ({ onError }: { onError: () => void }) => <img alt="bitmap" onError={onError} />,
  Text: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));
afterEach(cleanup);
it("retains a semantic placeholder after bitmap failure and retries a changed source", () => {
  const { rerender } = render(<IconImage name="mail" source={1} color="black" size={22} />);
  fireEvent.error(screen.getByAltText("bitmap"));
  expect(screen.getByText("M")).toBeVisible();
  expect(screen.queryByAltText("bitmap")).toBeNull();
  rerender(<IconImage name="calendar" source={2} color="black" size={22} />);
  expect(screen.getByAltText("bitmap")).toBeVisible();
  fireEvent.error(screen.getByAltText("bitmap"));
  expect(screen.getByText("C")).toBeVisible();
});
