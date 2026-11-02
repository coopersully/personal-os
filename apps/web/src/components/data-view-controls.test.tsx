// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DataChoice, FilterBar, FilterTrigger, SearchDataControls } from "./data-view-controls";

import { InputGroup, InputGroupInput } from "./ui/input-group";

afterEach(cleanup);
it("shows inactive plus triggers and checked choices using the shared menu", async () => {
  const change = vi.fn();
  render(
    <DataChoice
      label="Status"
      value="all"
      active={false}
      choices={[
        ["all", "All Statuses"],
        ["done", "Done"],
      ]}
      onChange={change}
    />,
  );
  expect(screen.getByRole("button", { name: "Status: All Statuses" })).toHaveAttribute(
    "data-filter-active",
    "false",
  );
  await userEvent.click(screen.getByRole("button", { name: "Status: All Statuses" }));
  await userEvent.click(screen.getByRole("menuitemradio", { name: "Done" }));
  expect(change).toHaveBeenCalledWith("done");
});
it("orders active controls first and keeps an unbounded filter list searchable behind More", async () => {
  const filters = Array.from({ length: 8 }, (_, index) => ({
    id: String(index),
    label: `Criterion ${index}`,
    active: index === 7,
    control: (
      <FilterTrigger
        label={`Criterion ${index}`}
        aria-label={`Criterion ${index}`}
        active={index === 7}
      />
    ),
  }));
  render(<FilterBar filters={filters} />);
  const controls = screen.getByRole("group", { name: "Filters and sorting" });
  expect(within(controls).getAllByRole("button")[0]).toHaveAccessibleName("Criterion 7");
  expect(screen.queryByRole("button", { name: "Criterion 6" })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "More filters" }));
  await userEvent.type(screen.getByRole("textbox", { name: "Find a filter" }), "Criterion 6");
  const dialog = screen.getByRole("dialog", { name: "Filters" });
  expect(within(dialog).getByRole("button", { name: "Criterion 6" })).toBeInTheDocument();
  expect(within(dialog).queryByRole("button", { name: "Criterion 7" })).not.toBeInTheDocument();
});

it("appends icon controls to search while retaining readable filter-dialog choices", async () => {
  render(
    <InputGroup>
      <InputGroupInput aria-label="Search records" />
      <SearchDataControls>
        <FilterBar
          collapsed
          filters={[
            {
              id: "status",
              label: "Status",
              active: true,
              control: (
                <DataChoice
                  label="Status"
                  value="done"
                  choices={[
                    ["all", "All Statuses"],
                    ["done", "Done"],
                  ]}
                  onChange={() => {}}
                />
              ),
            },
          ]}
        >
          <DataChoice
            label="Sort"
            value="oldest"
            choices={[
              ["newest", "Newest First"],
              ["oldest", "Oldest First"],
            ]}
            sorting
            onChange={() => {}}
          />
        </FilterBar>
      </SearchDataControls>
    </InputGroup>,
  );
  const input = screen.getByRole("textbox", { name: "Search records" });
  const group = input.closest('[data-slot="input-group"]');
  expect(group).toContainElement(screen.getByRole("button", { name: "Filters" }));
  expect(
    screen.getByRole("button", { name: "Sort: Oldest First" }).querySelector('[data-slot="badge"]'),
  ).toHaveTextContent("1");
  await userEvent.click(screen.getByRole("button", { name: "Filters" }));
  const dialog = screen.getByRole("dialog", { name: "Filters" });
  expect(
    within(within(dialog).getByRole("button", { name: "Status: Done" })).getByText("Done"),
  ).not.toHaveClass("sr-only");
});
