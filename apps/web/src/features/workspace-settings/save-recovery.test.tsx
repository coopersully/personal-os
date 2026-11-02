// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { SettingsSaveRecovery } from "./save-recovery";

it("explains each decision and requires review before either choice can apply", () => {
  const refresh = vi.fn();
  const accept = vi.fn();
  const apply = vi.fn();
  const props = {
    title: "Review your settings",
    outcome: "conflict" as const,
    rows: [{ label: "View", attempted: "Day", current: "Week" }],
    pending: false,
    onRefresh: refresh,
    onAccept: accept,
    onReapply: apply,
  };
  const { rerender } = render(<SettingsSaveRecovery {...props} reviewed={false} />);
  expect(screen.getByRole("button", { name: "Use latest settings" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Reapply reviewed change" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Refresh latest settings" }));
  expect(refresh).toHaveBeenCalledOnce();
  expect(accept).not.toHaveBeenCalled();
  expect(apply).not.toHaveBeenCalled();
  rerender(<SettingsSaveRecovery {...props} reviewed />);
  const keep = screen.getByRole("button", { name: "Use latest settings" });
  const reapply = screen.getByRole("button", { name: "Reapply reviewed change" });
  expect(keep).toHaveAccessibleDescription(
    "Discard your attempted change and use the saved values.",
  );
  expect(reapply).toHaveAccessibleDescription(
    "Save your attempted values after reviewing the latest settings.",
  );
  fireEvent.click(keep);
  expect(accept).toHaveBeenCalledOnce();
  expect(apply).not.toHaveBeenCalled();
});
