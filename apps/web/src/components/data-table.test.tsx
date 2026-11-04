// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { csvCell, type DataColumn, DataTable, DataTableActions } from "./data-table";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
const rows = [
  { id: "a", name: "First record", notes: "A long note" },
  { id: "b", name: "Second record", notes: "=1+1" },
];
const columns: DataColumn<(typeof rows)[number]>[] = [
  { id: "name", label: "Name", value: (row) => row.name, primary: true },
  { id: "notes", label: "Notes", value: (row) => row.notes, defaultHidden: true },
];
const props = {
  columns,
  rowId: (row: (typeof rows)[number]) => row.id,
  rowLabel: (row: (typeof rows)[number]) => `Open ${row.name}`,
  onOpen: vi.fn(),
  storageKey: "table-test",
  label: "Records",
  fileName: "records.csv",
};
beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it("configures visible columns and keyboard resizing and restores the saved layout", async () => {
  const user = userEvent.setup();
  const view = render(<DataTable {...props} rows={rows} />);
  expect(screen.queryByRole("columnheader", { name: "Notes" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Export Page" })).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Table actions" }));
  await user.click(screen.getByRole("menuitem", { name: "Table Options" }));
  await user.click(screen.getByRole("checkbox", { name: "Notes" }));
  fireEvent.keyDown(screen.getByRole("button", { name: "Reorder Notes" }), { key: "ArrowUp" });
  await user.click(screen.getByRole("button", { name: "Done" }));
  const resizer = screen.getByRole("separator", { name: "Resize Notes" });
  fireEvent.keyDown(resizer, { key: "ArrowRight" });
  expect(resizer).toHaveAttribute("aria-valuenow", "176");
  expect(screen.getAllByRole("columnheader")[1]).toHaveTextContent("Notes");
  view.unmount();
  render(<DataTable {...props} rows={rows} />);
  expect(screen.getByRole("separator", { name: "Resize Notes" })).toHaveAttribute(
    "aria-valuenow",
    "176",
  );
  await user.click(screen.getByRole("button", { name: "Open First record" }));
  expect(props.onOpen).toHaveBeenCalledWith(rows[0]);
});
it("bounds selection and CSV export to the current page", async () => {
  const user = userEvent.setup();
  const create = vi.fn().mockReturnValue("blob:csv");
  vi.stubGlobal("URL", { createObjectURL: create, revokeObjectURL: vi.fn() });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  const view = render(<DataTable {...props} rows={rows} />);
  await user.click(screen.getByRole("checkbox", { name: "Select Open First record" }));
  await user.click(screen.getByRole("button", { name: "Table actions" }));
  await user.click(screen.getByRole("menuitem", { name: "Export Selected" }));
  expect(create).toHaveBeenCalledWith(expect.any(Blob));
  expect(toast.success).toHaveBeenCalledWith("CSV download started for 1 row.");
  view.rerender(<DataTable {...props} rows={[{ id: "c", name: "Other page", notes: "" }]} />);
  expect(screen.queryByText("1 selected on this page")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Table actions" }));
  expect(screen.getByRole("menuitem", { name: "Export Page" })).toBeEnabled();
});
it("renders compact labelled records on mobile and reports storage failures only through Sonner", async () => {
  vi.stubGlobal("innerWidth", 375);
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  render(<DataTable {...props} rows={rows} />);
  await waitFor(() => expect(screen.queryByRole("table")).not.toBeInTheDocument());
  expect(screen.getByRole("button", { name: "Open First record" })).toBeInTheDocument();
  expect(toast.error).toHaveBeenCalledWith(
    "Couldn’t save your table layout on this device.",
    expect.anything(),
  );
  expect(
    screen.queryByText("Couldn’t save your table layout on this device."),
  ).not.toBeInTheDocument();
});
it("quotes CSV cells and treats spreadsheet formula text as literal content", () => {
  expect(csvCell('a,"b"')).toBe('"a,""b"""');
  expect(csvCell("=1+1")).toBe('"\'=1+1"');
  expect(csvCell(-2)).toBe('"-2"');
});

it("opens a record from its row without intercepting nested controls or double opening", () => {
  render(
    <DataTable
      {...props}
      rows={rows}
      columns={columns.map((column) => ({ ...column, defaultHidden: false }))}
    />,
  );
  fireEvent.click(screen.getByText("A long note"));
  expect(props.onOpen).toHaveBeenCalledExactlyOnceWith(rows[0]);
  props.onOpen.mockClear();
  fireEvent.click(screen.getByRole("checkbox", { name: "Select Open First record" }));
  expect(props.onOpen).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Open First record" }));
  expect(props.onOpen).toHaveBeenCalledExactlyOnceWith(rows[0]);
});

it.each([
  "{broken",
  JSON.stringify({ order: {}, hidden: [] }),
  JSON.stringify({ order: [], hidden: "notes" }),
])("falls back to a usable table when saved layout data is malformed: %s", (saved) => {
  localStorage.setItem("nohmi:data-view:table-test", saved);
  render(<DataTable {...props} rows={rows} />);
  expect(screen.getByRole("columnheader", { name: /^Name/ })).toBeInTheDocument();
  expect(screen.queryByRole("columnheader", { name: "Notes" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Open First record" })).toBeEnabled();
});

it("repairs stale columns and invalid widths while keeping the primary identity visible", () => {
  localStorage.setItem(
    "nohmi:data-view:table-test",
    JSON.stringify({
      order: [null, "unknown", "notes", "notes"],
      hidden: ["unknown", "name", 1],
      density: "comfortable",
      wrap: true,
      sizing: { name: "wide", notes: 240, unknown: 100 },
    }),
  );
  render(<DataTable {...props} rows={rows} />);
  const headers = screen.getAllByRole("columnheader");
  expect(headers[1]).toHaveTextContent("Notes");
  expect(headers[2]).toHaveTextContent("Name");
  expect(screen.getByRole("separator", { name: "Resize Notes" })).toHaveAttribute(
    "aria-valuenow",
    "240",
  );
  expect(screen.getByRole("separator", { name: "Resize Name" })).toHaveAttribute(
    "aria-valuenow",
    "160",
  );
  expect(screen.getByRole("button", { name: "Open First record" })).toBeEnabled();
});

it("changes density and wrapping, clamps keyboard widths, and resets the saved layout", async () => {
  const user = userEvent.setup();
  render(<DataTable {...props} rows={rows} />);
  const resizer = screen.getByRole("separator", { name: "Resize Name" });
  fireEvent.keyDown(resizer, { key: "Escape" });
  expect(resizer).toHaveAttribute("aria-valuenow", "160");
  for (let i = 0; i < 40; i++) fireEvent.keyDown(resizer, { key: "ArrowLeft" });
  expect(resizer).toHaveAttribute("aria-valuenow", "80");
  for (let i = 0; i < 40; i++) fireEvent.keyDown(resizer, { key: "ArrowRight" });
  expect(resizer).toHaveAttribute("aria-valuenow", "600");
  await user.click(screen.getByRole("button", { name: "Table actions" }));
  await user.click(screen.getByRole("menuitem", { name: "Table Options" }));
  fireEvent.change(screen.getByLabelText("Row spacing"), { target: { value: "comfortable" } });
  await user.click(screen.getByRole("switch", { name: "Wrap long text" }));
  await user.click(screen.getByRole("checkbox", { name: "Notes" }));
  await user.click(screen.getByRole("checkbox", { name: "Notes" }));
  await user.click(screen.getByRole("button", { name: "Reset Layout" }));
  expect(screen.getByRole("switch", { name: "Wrap long text" })).not.toBeChecked();
  expect(screen.getByLabelText("Row spacing")).toHaveValue("compact");
  await user.click(screen.getByRole("button", { name: "Done" }));
  expect(screen.getByRole("separator", { name: "Resize Name" })).toHaveAttribute(
    "aria-valuenow",
    "160",
  );
});

it("supports mobile-specific cells and page selection without losing record actions", async () => {
  vi.stubGlobal("innerWidth", 375);
  const user = userEvent.setup();
  render(
    <DataTable
      {...props}
      rows={rows}
      caption="Current page"
      columns={[
        {
          ...columns[0]!,
          header: <button type="button">Sort name</button>,
          mobileCell: (row) => `Mobile ${row.name}`,
        },
        { ...columns[1]!, defaultHidden: false, mobileOrder: 1 },
        { id: "extra", label: "Extra", value: () => "Desktop-only content", mobileHidden: true },
      ]}
    />,
  );
  expect(await screen.findByText("Mobile First record")).toBeInTheDocument();
  expect(screen.queryByText("Desktop-only content")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Table actions" }));
  await user.click(screen.getByRole("menuitem", { name: "Select page" }));
  expect(screen.getByText("2 selected on this page")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Clear selection" }));
  expect(screen.getByText("Current page")).toBeInTheDocument();
  fireEvent.click(screen.getByText("A long note"));
  expect(props.onOpen).toHaveBeenCalledExactlyOnceWith(rows[0]);
});

it("disables empty exports and reports download failures through Sonner", async () => {
  const user = userEvent.setup();
  const create = vi.fn(() => {
    throw new Error("Download unavailable");
  });
  vi.stubGlobal("URL", { createObjectURL: create, revokeObjectURL: vi.fn() });
  const view = render(<DataTable {...props} rows={[]} />);
  expect(screen.getByRole("checkbox", { name: "Select all rows on this page" })).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "Table actions" }));
  expect(screen.getByRole("menuitem", { name: "Export Page" })).toHaveAttribute(
    "aria-disabled",
    "true",
  );
  await user.keyboard("{Escape}");
  view.rerender(<DataTable {...props} rows={rows} />);
  await user.click(screen.getByRole("button", { name: "Table actions" }));
  await user.click(screen.getByRole("menuitem", { name: "Export Page" }));
  expect(toast.error).toHaveBeenCalledWith("Couldn’t start the CSV download. Try again.");
  expect(screen.queryByText("Couldn’t start the CSV download. Try again.")).not.toBeInTheDocument();
});

it("toggles all page rows, renders custom values, and tolerates unavailable layout storage", async () => {
  const user = userEvent.setup();
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("Storage blocked");
  });
  render(
    <DataTable
      {...props}
      rows={rows}
      columns={[
        {
          id: "name",
          label: "Name",
          primary: true,
          value: (row) => row.name,
          cell: (row) => `Custom ${row.name}`,
        },
        {
          id: "notes",
          label: "Notes",
          value: (row) => row.notes,
          cell: (row) => `Note ${row.notes}`,
        },
      ]}
    />,
  );
  expect(screen.getByText("Custom First record")).toBeInTheDocument();
  expect(screen.getByText("Note A long note")).toBeInTheDocument();
  const all = screen.getByRole("checkbox", { name: "Select all rows on this page" });
  await user.click(all);
  expect(all).toBeChecked();
  expect(screen.getByText("2 selected on this page")).toBeInTheDocument();
  await user.click(all);
  expect(all).not.toBeChecked();
  expect(screen.queryByText("2 selected on this page")).not.toBeInTheDocument();
  expect(props.onOpen).not.toHaveBeenCalled();
});

it("keeps mobile selection separate from opening and preserves wrapped custom details", async () => {
  vi.stubGlobal("innerWidth", 375);
  localStorage.setItem(
    "nohmi:data-view:table-test",
    JSON.stringify({ order: ["name", "notes"], hidden: [], wrap: true }),
  );
  const user = userEvent.setup();
  render(
    <DataTable
      {...props}
      rows={rows}
      columns={[
        {
          id: "name",
          label: "Name",
          primary: true,
          value: (row) => row.name,
          cell: (row) => `Title ${row.name}`,
        },
        {
          id: "notes",
          label: "Notes",
          value: (row) => row.notes,
          mobileCell: (row) => `Detail ${row.notes}`,
        },
      ]}
    />,
  );
  expect(screen.getByText("Detail A long note")).toBeInTheDocument();
  await user.click(screen.getByRole("checkbox", { name: "Select Open First record" }));
  expect(screen.getByText("1 selected on this page")).toBeInTheDocument();
  expect(props.onOpen).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Open First record" }));
  expect(props.onOpen).toHaveBeenCalledExactlyOnceWith(rows[0]);
});

it("resizes a column with a pointer and persists the accepted width", () => {
  render(<DataTable {...props} rows={rows} />);
  const resizer = screen.getByRole("separator", { name: "Resize Name" });
  fireEvent.mouseDown(resizer, { clientX: 100 });
  fireEvent.mouseMove(document, { clientX: 140 });
  fireEvent.mouseUp(document, { clientX: 140 });
  expect(resizer).toHaveAttribute("aria-valuenow", "200");
  expect(JSON.parse(localStorage.getItem("nohmi:data-view:table-test")!).sizing.name).toBe(200);
});

it("uses domain-owned selection for actions and clears it without opening the row", () => {
  const clear = vi.fn();
  const controls = {
    header: <span>Domain selection</span>,
    cell: (row: (typeof rows)[number]) => (
      <input type="checkbox" aria-label={`Domain ${row.name}`} readOnly checked={row.id === "a"} />
    ),
    selected: [rows[0]!],
    clear,
    selectPage: vi.fn(),
    locked: false,
    actions: <button type="button">Categorize selected</button>,
  };
  render(<DataTable {...props} rows={rows} selectionControls={controls} />);
  expect(screen.getByText("1 selected on this page")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Categorize selected" })).toBeEnabled();
  expect(screen.getByRole("row", { name: "Open First record" })).toHaveAttribute(
    "data-state",
    "selected",
  );
  fireEvent.click(screen.getByRole("button", { name: "Clear selection" }));
  expect(clear).toHaveBeenCalledOnce();
  expect(props.onOpen).not.toHaveBeenCalled();
});

it("keeps command columns visible at the end despite older hidden and reordered layouts", async () => {
  localStorage.setItem(
    "nohmi:data-view:table-test",
    JSON.stringify({
      order: ["commands", "name", "notes"],
      hidden: ["commands"],
      sizing: { commands: 280 },
    }),
  );
  const command = vi.fn();
  render(
    <DataTable
      {...props}
      rows={rows}
      columns={[
        {
          id: "commands",
          kind: "actions",
          label: "Legacy commands",
          defaultHidden: true,
          value: () => "",
          cell: (row) => (
            <DataTableActions label={`Actions for ${row.name}`}>
              <button type="button" onClick={command}>
                Edit {row.name}
              </button>
            </DataTableActions>
          ),
        },
        ...columns,
      ]}
    />,
  );
  const headers = screen.getAllByRole("columnheader");
  expect(headers.at(-1)).toHaveTextContent("Actions");
  expect(headers.at(-1)).toHaveAttribute("data-column-kind", "actions");
  expect(headers.at(-1)).toHaveStyle({ width: "80px" });
  expect(screen.queryByRole("separator", { name: "Resize Legacy commands" })).toBeNull();
  await userEvent.click(screen.getByRole("button", { name: "Edit First record" }));
  fireEvent.click(screen.getByRole("group", { name: "Actions for First record" }));
  expect(command).toHaveBeenCalledOnce();
  expect(props.onOpen).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: "Table actions" }));
  await userEvent.click(screen.getByRole("menuitem", { name: "Table Options" }));
  expect(screen.getByText("Always visible · pinned to end")).toBeVisible();
  expect(screen.queryByRole("button", { name: "Reorder Legacy commands" })).toBeNull();
  expect(screen.queryByRole("checkbox", { name: "Legacy commands" })).toBeNull();
});

it("retains command buttons in mobile records even when old layouts hid them", async () => {
  vi.stubGlobal("innerWidth", 375);
  localStorage.setItem(
    "nohmi:data-view:table-test",
    JSON.stringify({ order: ["commands", "name"], hidden: ["commands"] }),
  );
  render(
    <DataTable
      {...props}
      rows={rows}
      columns={[
        ...columns,
        {
          id: "commands",
          kind: "actions",
          label: "Actions",
          mobileHidden: true,
          value: () => "",
          cell: (row) => (
            <DataTableActions label={`Actions for ${row.name}`}>
              <button type="button">Edit {row.name}</button>
            </DataTableActions>
          ),
        },
      ]}
    />,
  );
  await waitFor(() => expect(screen.queryByRole("table")).toBeNull());
  expect(screen.getByRole("button", { name: "Edit First record" })).toBeVisible();
  expect(screen.getAllByText("Actions")).toHaveLength(2);
  expect(
    screen.getByRole("group", { name: "Actions for First record" }).closest("dl")?.lastElementChild,
  ).toHaveTextContent("Edit First record");
});
