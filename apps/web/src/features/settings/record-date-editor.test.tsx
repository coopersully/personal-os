// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { RecordDateEditor } from "./record-date-editor";

it("retains a rejected date clear and closes only after a successful retry", async () => {
  const user = userEvent.setup();
  const save = vi.fn().mockRejectedValueOnce(new Error("Unavailable")).mockResolvedValue(undefined);
  render(<RecordDateEditor value="2026-10-22" pending={false} onSave={save} />);
  await user.click(screen.getByRole("button", { name: "Edit Target date" }));
  await user.click(screen.getByRole("button", { name: "Clear date" }));
  await waitFor(() => expect(save).toHaveBeenCalledWith(""));
  const clear = screen.getByRole("button", { name: "Clear date" });
  await waitFor(() => expect(clear).toBeEnabled());
  expect(screen.getByRole("button", { name: "Edit Target date" })).toHaveTextContent(
    "Oct 22, 2026",
  );
  await user.click(clear);
  await waitFor(() =>
    expect(screen.queryByRole("button", { name: "Clear date" })).not.toBeInTheDocument(),
  );
  expect(save).toHaveBeenCalledTimes(2);
});

it("chooses a date from an empty value and disables editing while the owner is pending", async () => {
  const user = userEvent.setup();
  const save = vi.fn().mockResolvedValue(undefined);
  const view = render(<RecordDateEditor value="" pending onSave={save} />);
  const trigger = screen.getByRole("button", { name: "Edit Target date" });
  expect(trigger).toHaveTextContent("Not set");
  expect(trigger).toBeDisabled();
  view.rerender(<RecordDateEditor value="" pending={false} onSave={save} />);
  await user.click(trigger);
  expect(screen.queryByRole("button", { name: "Clear date" })).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: /\b22(?:nd)?\b/ }));
  await waitFor(() => expect(save).toHaveBeenCalledWith(expect.stringMatching(/^\d{4}-\d{2}-22$/)));
  await waitFor(() => expect(trigger).toHaveAttribute("data-state", "closed"));
});
