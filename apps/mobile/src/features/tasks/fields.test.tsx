// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { type PropsWithChildren, useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { ListAppearance } from "./list-appearance";
import { SearchableChoice } from "./searchable-choice";
import { TagsField } from "./tags-field";
import { Choice } from "./ui";

vi.mock("react", async () => {
  const { createRequire } = await import("node:module");
  return createRequire(`${process.cwd()}/package.json`)("react");
});
vi.mock("react-native", async () => import("../../../test/native"));
vi.mock("react-native-safe-area-context", () => ({
  SafeAreaView: ({ children }: PropsWithChildren) => <div>{children}</div>,
}));
vi.mock("../../components/icons", () => ({
  Icon: ({ name }: { name: string }) => <span data-icon={name} />,
}));
afterEach(cleanup);
function Tags({ initial = [] }: { initial?: string[] }) {
  const [tags, setTags] = useState(initial);
  return <TagsField value={tags} onChange={setTags} />;
}
it("adds trimmed individual badges, prevents duplicates, removes and cancels without saving", () => {
  render(<Tags />);
  fireEvent.click(screen.getByRole("button", { name: "Add tag" }));
  expect(screen.getByRole("button", { name: "Add" })).toBeDisabled();
  fireEvent.change(screen.getByLabelText("New tag"), { target: { value: "  errands  " } });
  fireEvent.keyDown(screen.getByLabelText("New tag"), { key: "Enter" });
  expect(screen.getByRole("button", { name: "Remove tag errands" })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Add tag" }));
  fireEvent.change(screen.getByLabelText("New tag"), { target: { value: "errands" } });
  fireEvent.click(screen.getByRole("button", { name: "Add" }));
  expect(screen.getAllByRole("button", { name: "Remove tag errands" })).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "Add tag" }));
  fireEvent.change(screen.getByLabelText("New tag"), { target: { value: "private draft" } });
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  fireEvent.click(screen.getByRole("button", { name: "Add tag" }));
  expect(screen.getByLabelText("New tag")).toHaveValue("");
  fireEvent.keyDown(screen.getByLabelText("New tag"), { key: "Enter" });
  expect(screen.getByLabelText("New tag")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  fireEvent.click(screen.getByRole("button", { name: "Remove tag errands" }));
  expect(screen.queryByText("errands")).not.toBeInTheDocument();
});
it("limits badges to twenty and permits adding again after removal", () => {
  render(<Tags initial={Array.from({ length: 20 }, (_, i) => `tag ${i}`)} />);
  expect(screen.queryByRole("button", { name: "Add tag" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Remove tag tag 0" }));
  expect(screen.getByRole("button", { name: "Add tag" })).toBeVisible();
});
it("searches entity choices, preserves selection on cancel, and resets search after selection", () => {
  const change = vi.fn();
  const options = [
    { value: "", label: "None" },
    { value: "home", label: "Home repairs" },
    { value: "work", label: "Work" },
  ];
  const { rerender } = render(
    <SearchableChoice
      label="Project"
      entity="project"
      value="work"
      options={options}
      onChange={change}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Project, Work" }));
  expect(screen.getByRole("button", { name: "Work" })).toHaveAttribute("aria-pressed", "true");
  fireEvent.change(screen.getByLabelText("Search project"), { target: { value: "missing" } });
  expect(screen.getByText("No matches. Try a different name.")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(change).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Project, Work" }));
  expect(screen.getByLabelText("Search project")).toHaveValue("");
  fireEvent.change(screen.getByLabelText("Search project"), { target: { value: "HOME" } });
  fireEvent.click(screen.getByRole("button", { name: "Home repairs" }));
  expect(change).toHaveBeenCalledWith("home");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  rerender(
    <SearchableChoice
      label="Project"
      value="missing"
      options={options}
      onChange={change}
      disabled
    />,
  );
  expect(screen.getByRole("button", { name: "Project, None" })).toBeDisabled();
});
it("edits icon and color together, validates custom hex colors and discards canceled drafts", () => {
  const change = vi.fn();
  render(<ListAppearance icon="list" color="" onChange={change} />);
  fireEvent.click(screen.getByRole("button", { name: "Edit list icon and color" }));
  fireEvent.click(screen.getByRole("button", { name: "home icon" }));
  fireEvent.change(screen.getByLabelText("Custom color (hex)"), { target: { value: "bad" } });
  expect(screen.getByRole("button", { name: "Done" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(change).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Edit list icon and color" }));
  expect(screen.getByRole("button", { name: "list icon" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByLabelText("Custom color (hex)")).toHaveValue("");
  fireEvent.click(screen.getByRole("button", { name: "star icon" }));
  fireEvent.click(screen.getByRole("button", { name: "#22c55e" }));
  fireEvent.click(screen.getByRole("button", { name: "Done" }));
  expect(change).toHaveBeenCalledWith("star", "#22c55e");
  fireEvent.click(screen.getByRole("button", { name: "Edit list icon and color" }));
  fireEvent.change(screen.getByLabelText("Custom color (hex)"), { target: { value: "#Ab12Ef" } });
  fireEvent.click(screen.getByRole("button", { name: "Done" }));
  expect(change).toHaveBeenLastCalledWith("list", "#Ab12Ef");
});

it("renders an unavailable setting as None and permits choosing a supported replacement", () => {
  const change = vi.fn();
  const { rerender } = render(
    <Choice
      label="Priority"
      value="removed"
      options={[{ value: "high", label: "High" }]}
      onChange={change}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Priority, None" }));
  fireEvent.click(screen.getByRole("radio", { name: "High" }));
  expect(change).toHaveBeenCalledWith("high");
  rerender(
    <Choice
      label="Priority"
      value="high"
      options={[{ value: "high", label: "High" }]}
      onChange={change}
      disabled
    />,
  );
  expect(screen.getByRole("button", { name: "Priority, High" })).toBeDisabled();
});
