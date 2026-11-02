// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { RecordTextEditor } from "./record-text-editor";

describe("RecordTextEditor", () => {
  it("saves an edited title and cancels a later draft", async () => {
    const user = userEvent.setup();
    const save = vi.fn().mockResolvedValue(undefined);
    render(<RecordTextEditor label="Title" value="Original" required onSave={save} />);
    await user.click(screen.getByRole("button", { name: "Edit Title" }));
    await user.clear(screen.getByRole("textbox", { name: "Title" }));
    await user.type(screen.getByRole("textbox", { name: "Title" }), "Updated{Enter}");
    await waitFor(() => expect(save).toHaveBeenCalledWith("Updated"));
    await user.click(screen.getByRole("button", { name: "Edit Title" }));
    await user.type(screen.getByRole("textbox", { name: "Title" }), " draft{Escape}");
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("rejects blank titles and retains drafts when saving fails", async () => {
    const user = userEvent.setup();
    const save = vi.fn().mockRejectedValue(new Error("Failed"));
    render(<RecordTextEditor label="Title" value="Original" required onSave={save} />);
    await user.click(screen.getByRole("button", { name: "Edit Title" }));
    const input = screen.getByRole("textbox", { name: "Title" });
    await user.clear(input);
    await user.keyboard("{Enter}");
    expect(save).not.toHaveBeenCalled();
    await user.type(input, "Retry me{Enter}");
    await waitFor(() => expect(input).not.toBeDisabled());
    expect(input).toHaveValue("Retry me");
  });
});

it("keeps multiline Enter local and commits trimmed content with a keyboard shortcut", async () => {
  const user = userEvent.setup();
  const save = vi.fn().mockResolvedValue(undefined);
  render(<RecordTextEditor label="Context" value="" multiline onSave={save} />);
  await user.click(screen.getByRole("button", { name: "Edit Context" }));
  const editor = screen.getByRole("textbox", { name: "Context" });
  await user.type(editor, "  First line{Enter}Second line  ");
  expect(editor).toHaveValue("  First line\nSecond line  ");
  expect(save).not.toHaveBeenCalled();
  await user.keyboard("{Control>}{Enter}{/Control}");
  await waitFor(() => expect(save).toHaveBeenCalledWith("First line\nSecond line"));
  expect(await screen.findByRole("button", { name: "Edit Context" })).toBeEnabled();
  expect(save).toHaveBeenCalledTimes(1);
});

it("does not save an unchanged blur, but allows clearing optional text", async () => {
  const user = userEvent.setup();
  const save = vi.fn().mockResolvedValue(undefined);
  render(<RecordTextEditor label="Context" value="Original" onSave={save} />);
  await user.click(screen.getByRole("button", { name: "Edit Context" }));
  await user.tab();
  expect(await screen.findByRole("button", { name: "Edit Context" })).toBeEnabled();
  expect(save).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Edit Context" }));
  await user.clear(screen.getByRole("textbox", { name: "Context" }));
  await user.tab();
  await waitFor(() => expect(save).toHaveBeenCalledWith(""));
});

it("prevents duplicate commits while saving and retries the preserved draft", async () => {
  const user = userEvent.setup();
  let reject!: (error: Error) => void;
  const save = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise((_resolve, failed) => {
          reject = failed;
        }),
    )
    .mockResolvedValue(undefined);
  render(<RecordTextEditor label="Context" value="Original" multiline onSave={save} />);
  await user.click(screen.getByRole("button", { name: "Edit Context" }));
  const editor = screen.getByRole("textbox", { name: "Context" });
  await user.clear(editor);
  await user.type(editor, "Preserved");
  await user.keyboard("{Meta>}{Enter}{/Meta}");
  await waitFor(() => expect(editor).toBeDisabled());
  expect(save).toHaveBeenCalledTimes(1);
  reject(new Error("Unavailable"));
  await waitFor(() => expect(editor).toBeEnabled());
  expect(editor).toHaveValue("Preserved");
  await user.click(editor);
  await user.keyboard("{Meta>}{Enter}{/Meta}");
  await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
  expect(save).toHaveBeenLastCalledWith("Preserved");
});
