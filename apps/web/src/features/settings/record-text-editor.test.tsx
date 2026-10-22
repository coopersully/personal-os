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
