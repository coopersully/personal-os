// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ToggleRow } from "./form-rows";

vi.mock("react", async () => {
  const { createRequire } = await import("node:module");
  return createRequire(`${process.cwd()}/package.json`)("react");
});
vi.mock("react-native", async () => import("../../../test/native"));
vi.mock("../icons", () => ({ Icon: () => null }));
vi.mock("../../features/auth/context", () => ({ useOptionalAuth: () => null }));
vi.mock("../settings-accent", () => ({
  useSettingsAccent: () => "#111111",
  useSettingsAccentColor: (accent: string) => accent,
}));
afterEach(cleanup);

it("sets a detail under the label while the label alone names the switch", () => {
  const onChange = vi.fn();
  render(
    <ToggleRow
      label="Change Calendar settings"
      detail="Only when your review policy allows it."
      value={false}
      onChange={onChange}
    />,
  );
  expect(screen.getByText("Only when your review policy allows it.")).toBeVisible();
  fireEvent.click(screen.getByRole("switch", { name: "Change Calendar settings" }));
  expect(onChange).toHaveBeenCalledWith(true);
});

it("renders only the label when a switch has no detail", () => {
  const { container } = render(<ToggleRow label="Read mail" value onChange={() => {}} />);
  expect(container.querySelectorAll("span")).toHaveLength(1);
  expect(screen.getByRole("switch", { name: "Read mail" })).toBeChecked();
});
