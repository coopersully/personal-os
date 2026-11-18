// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { AccountRecoveryDialog } from "./account-recovery-dialog";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "./ui/dialog";

vi.mock("sonner", () => ({ toast: { loading: vi.fn(), error: vi.fn(), dismiss: vi.fn() } }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
const failed = { isError: true, isSuccess: false, isFetching: false };
it("requires confirmed recovery, prevents dismissal, and retains focus and workspace content", async () => {
  let finish: (value: { isError: boolean }) => void = () => {};
  const refetch = vi.fn(
    () =>
      new Promise<{ isError: boolean }>((resolve) => {
        finish = resolve;
      }),
  );
  const view = render(
    <AccountRecoveryDialog query={{ ...failed, refetch }}>
      <button type="button">Server settings</button>
    </AccountRecoveryDialog>,
  );
  expect(screen.getByRole("dialog")).toHaveTextContent("Reconnect to your account");
  expect(screen.queryByRole("button", { name: "Close" })).not.toBeInTheDocument();
  expect(toast.error).not.toHaveBeenCalled();
  await userEvent.setup().keyboard("{Escape}");
  fireEvent.pointerDown(document.body);
  expect(screen.getByRole("dialog")).toBeVisible();
  await userEvent.setup().click(screen.getByRole("button", { name: "Try again" }));
  expect(screen.getByRole("button", { name: "Reconnecting…" })).toHaveAttribute(
    "aria-disabled",
    "true",
  );
  view.rerender(
    <AccountRecoveryDialog
      query={{ isError: false, isSuccess: false, isFetching: true, refetch }}
    />,
  );
  expect(screen.getByRole("dialog")).toBeVisible();
  await act(async () => finish({ isError: false }));
  // Resolving a request alone is insufficient: the authoritative query must confirm success.
  expect(screen.getByRole("dialog")).toBeVisible();
  view.rerender(
    <AccountRecoveryDialog
      query={{ isError: false, isSuccess: true, isFetching: false, refetch }}
    />,
  );
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(toast.loading).toHaveBeenCalledOnce();
});
it.each([
  "error-result",
  "rejection",
])("retains recovery and reports a safe retry failure for %s", async (mode) => {
  const refetch =
    mode === "rejection"
      ? vi.fn().mockRejectedValue(new Error("private credentials"))
      : vi.fn().mockResolvedValue({ isError: true });
  render(<AccountRecoveryDialog query={{ ...failed, refetch }} />);
  await userEvent.setup().click(screen.getByRole("button", { name: "Try again" }));
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith(
      "Couldn’t reconnect to your account.",
      expect.any(Object),
    ),
  );
  expect(screen.getByRole("dialog")).toBeVisible();
  expect(screen.getByRole("button", { name: "Try again" })).toBeEnabled();
  expect(screen.queryByText(/private credentials/)).not.toBeInTheDocument();
  expect(vi.mocked(toast.loading).mock.calls[0]?.[1]?.id).toBe(
    vi.mocked(toast.error).mock.calls[0]?.[1]?.id,
  );
});
it("does not block excluded authentication flows or an already healthy account", () => {
  const refetch = vi.fn().mockResolvedValue({ isError: false });
  const view = render(<AccountRecoveryDialog enabled={false} query={{ ...failed, refetch }} />);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  view.rerender(
    <AccountRecoveryDialog
      query={{ isError: false, isSuccess: true, isFetching: false, refetch }}
    />,
  );
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it("restores the prior workspace focus after recovery", async () => {
  const refetch = vi.fn().mockResolvedValue({ isError: false });
  const healthy = { isError: false, isSuccess: true, isFetching: false, refetch };
  const content = (query: typeof healthy) => (
    <>
      <button type="button">Account details</button>
      <AccountRecoveryDialog query={query} />
    </>
  );
  const view = render(content(healthy));
  screen.getByRole("button", { name: "Account details" }).focus();
  view.rerender(content({ ...failed, refetch }));
  expect(screen.getByRole("dialog")).toBeVisible();
  view.rerender(content(healthy));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(screen.getByRole("button", { name: "Account details" })).toHaveFocus();
});

it("clears a failed-retry toast when background account verification recovers", async () => {
  const refetch = vi.fn().mockResolvedValue({ isError: true });
  const view = render(<AccountRecoveryDialog query={{ ...failed, refetch }} />);
  await userEvent.setup().click(screen.getByRole("button", { name: "Try again" }));
  await waitFor(() => expect(toast.error).toHaveBeenCalled());
  const id = vi.mocked(toast.error).mock.calls.at(-1)?.[1]?.id;
  vi.mocked(toast.dismiss).mockClear();
  view.rerender(
    <AccountRecoveryDialog
      query={{ isError: false, isSuccess: true, isFetching: false, refetch }}
    />,
  );
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(toast.dismiss).toHaveBeenCalledWith(id);
});

it("allows nested native server recovery without dismissing the account gate", async () => {
  const refetch = vi.fn().mockResolvedValue({ isError: true });
  render(
    <AccountRecoveryDialog query={{ ...failed, refetch }}>
      <Dialog>
        <DialogTrigger>Server settings</DialogTrigger>
        <DialogContent>
          <DialogTitle>Server connection</DialogTitle>
          <DialogDescription>Choose the configured server.</DialogDescription>
          <DialogClose>Back to account recovery</DialogClose>
        </DialogContent>
      </Dialog>
    </AccountRecoveryDialog>,
  );
  await userEvent.setup().click(screen.getByRole("button", { name: "Server settings" }));
  expect(screen.getByRole("dialog", { name: "Server connection" })).toBeVisible();
  await userEvent.setup().click(screen.getByRole("button", { name: "Back to account recovery" }));
  expect(screen.getByRole("dialog", { name: "Reconnect to your account" })).toBeVisible();
});
