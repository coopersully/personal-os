// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { MailFilters, type MailFilterValue } from "./filters";

vi.mock("react", async () => {
  const { createRequire } = await import("node:module");
  return createRequire(`${process.cwd()}/package.json`)("react");
});
vi.mock("react-native", async () => import("../../../test/native"));
vi.mock("../../components/icons", () => ({ Icon: () => null }));
afterEach(cleanup);
it("combines Unread and Flagged, toggles each independently and clears", () => {
  function Harness() {
    const [value, setValue] = useState<MailFilterValue>({});
    return (
      <>
        <MailFilters value={value} onChange={setValue} />
        <output>{JSON.stringify(value)}</output>
      </>
    );
  }
  render(<Harness />);
  fireEvent.click(screen.getByRole("button", { name: "Unread" }));
  expect(screen.getByRole("button", { name: "Unread" })).toHaveAttribute("aria-pressed", "true");
  fireEvent.click(screen.getByRole("button", { name: "Flagged" }));
  expect(screen.getByRole("status").textContent).toBe('{"unread":true,"starred":true}');
  fireEvent.click(screen.getByRole("button", { name: "Unread" }));
  expect(screen.getByRole("status").textContent).toBe('{"starred":true}');
  fireEvent.click(screen.getByRole("button", { name: "Clear mail filters" }));
  expect(screen.getByRole("status").textContent).toBe("{}");
});
