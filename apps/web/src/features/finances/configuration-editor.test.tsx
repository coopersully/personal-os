// @vitest-environment jsdom
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import { renderWithFeedback as render } from "@/test-utils/feedback";
import { FinanceConfigurationEditor } from "./configuration-editor";

const mocks = vi.hoisted(() => ({ query: vi.fn(), retry: vi.fn() }));
vi.mock("./use-finance-configuration.js", () => ({ useFinanceConfiguration: mocks.query }));
vi.mock("./configuration-income.js", () => ({ FinanceIncomeEditor: () => <p>Saved income</p> }));

it("keeps a failed profile read out of the settings layout with a retry action", async () => {
  mocks.query.mockReturnValue({
    isError: true,
    isSuccess: false,
    isFetching: false,
    error: new Error("private diagnostic"),
    refetch: mocks.retry,
  });
  render(<FinanceConfigurationEditor />);
  const notice = await screen.findByText("Financial settings could not load.");
  expect(notice.closest("[data-sonner-toast]")).not.toBeNull();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(screen.getByText("Saved income")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(mocks.retry).toHaveBeenCalledOnce();
  toast.dismiss();
});

it("guides recovery of an unavailable profile response in a dialog", async () => {
  mocks.retry.mockResolvedValue({ isError: false, data: { profile: { state: "unavailable" } } });
  mocks.query.mockReturnValue({
    isError: false,
    isSuccess: true,
    isFetching: false,
    data: { profile: { state: "unavailable" } },
    refetch: mocks.retry,
  });
  const view = render(<FinanceConfigurationEditor />);
  const recovery = await screen.findByRole("dialog", { name: "Financial settings could not load" });
  expect(view.container).not.toContainElement(recovery);
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await waitFor(() => expect(mocks.retry).toHaveBeenCalled());
  const outcome = await screen.findByText("Financial settings could not load. Try again.");
  expect(outcome.closest("[data-sonner-toast]")).not.toBeNull();
  expect(recovery).toBeInTheDocument();
});
