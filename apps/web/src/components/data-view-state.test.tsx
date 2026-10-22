// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { toast } from "sonner";
import { DataViewEmpty, DataViewLoading, DataViewRecovery } from "./data-view-state";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), dismiss: vi.fn() } }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
it("uses absence anatomy without inventing controls or actions", () => {
  render(<DataViewEmpty title="No records yet" />);
  expect(screen.getByText("No records yet").closest('[data-slot="empty"]')).toBeInTheDocument();
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
});
it("announces loading without implying a successful empty query", () => {
  render(<DataViewLoading label="Loading records" />);
  expect(screen.getByRole("status")).toHaveAttribute("aria-busy", "true");
  expect(screen.queryByText("No records yet")).not.toBeInTheDocument();
});
it("keeps recovery discoverable, announces errors once through Sonner, and preserves recovery state", () => {
  const refetch = vi.fn();
  const query = {
    isError: true,
    error: new Error("private diagnostics"),
    isFetching: false,
    refetch,
  };
  const view = render(
    <DataViewRecovery
      query={query}
      title="Couldn’t load records."
      unavailableLabel="Records unavailable"
    />,
  );
  expect(toast.error).toHaveBeenCalledTimes(1);
  expect(toast.error).toHaveBeenCalledWith("Couldn’t load records.", expect.any(Object));
  expect(screen.queryByText("Couldn’t load records.")).not.toBeInTheDocument();
  expect(screen.queryByText(/private diagnostics/)).not.toBeInTheDocument();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(refetch).toHaveBeenCalledOnce();
  view.rerender(
    <DataViewRecovery
      query={{ ...query, data: [], isFetching: true }}
      title="Couldn’t load records."
      unavailableLabel="Records unavailable"
    />,
  );
  expect(screen.getByText("Last available results")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Retrying…" })).toBeDisabled();
  expect(toast.error).toHaveBeenCalledTimes(1);
  view.rerender(
    <DataViewRecovery
      query={{ ...query, isError: false, error: null }}
      title="Couldn’t load records."
      unavailableLabel="Records unavailable"
    />,
  );
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
  expect(toast.dismiss).toHaveBeenCalled();
});
