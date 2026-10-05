// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SearchableSelect } from "./searchable-select";

it.each([
  "{Enter}",
  "{Tab}",
])("focuses search and commits a matching category with %s", async (key) => {
  const change = vi.fn();
  render(
    <>
      <SearchableSelect
        label="Category"
        value=""
        onValueChange={change}
        options={[
          { value: "food", label: "Dining" },
          { value: "home", label: "Housing" },
        ]}
      />
      <button type="button">Next field</button>
    </>,
  );
  const user = userEvent.setup();
  const search = screen.getByRole("combobox", { name: "Category" });
  await user.click(search);
  expect(search).toHaveFocus();
  await user.type(search, "Hous");
  await user.keyboard(key);
  await waitFor(() => expect(change).toHaveBeenCalledWith("home"));
  if (key === "{Tab}")
    await waitFor(() => expect(screen.getByRole("button", { name: "Next field" })).toHaveFocus());
});
it("does not create values when there are no matches", async () => {
  const change = vi.fn();
  render(
    <SearchableSelect
      label="Category"
      value=""
      onValueChange={change}
      options={[{ value: "food", label: "Dining" }]}
    />,
  );
  const user = userEvent.setup();
  await user.type(screen.getByRole("combobox", { name: "Category" }), "No category");
  await user.keyboard("{Enter}{Tab}");
  expect(change).not.toHaveBeenCalled();
});
