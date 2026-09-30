// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { RitualLocal } from "./ritual-local.js";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <RitualLocal />
    </QueryClientProvider>,
  );
  return client;
}
beforeEach(() => vi.resetAllMocks());
afterEach(cleanup);
it("shows unavailable instead of a false disabled status and retries a failed read", async () => {
  invoke
    .mockRejectedValueOnce(new Error("Private diagnostic detail"))
    .mockResolvedValue({ enabled: true, queue: [], localHistory: [], deliveryHealth: null });
  mount();
  expect(await screen.findByRole("alert")).toHaveTextContent("Ritual status unavailable");
  expect(screen.getByText("Automatic rituals on this Mac: unavailable")).toBeInTheDocument();
  expect(screen.queryByText(/Private diagnostic detail/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(await screen.findByText("Automatic rituals on this Mac: on")).toBeInTheDocument();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});
it.each([
  ["identity", "Unable to confirm the account"],
  ["store_read", "Unable to read saved ritual changes"],
  ["sync", "Unable to sync rituals"],
  ["store_write", "Unable to save ritual changes"],
  ["presentation", "Unable to show the ritual"],
  ["unknown", "Ritual delivery needs attention"],
])("shows redacted %s delivery failure and automatic retry", async (stage, message) => {
  invoke.mockResolvedValue({
    enabled: true,
    queue: [],
    localHistory: [],
    deliveryHealth: {
      stage,
      failedAt: "2026-09-29T12:00:00Z",
      nextRetryAt: "2026-09-29T12:00:05Z",
    },
  });
  const client = mount();
  expect(await screen.findByRole("alert")).toHaveTextContent(message!);
  expect(screen.getByRole("alert")).toHaveTextContent("Retrying automatically at");
  invoke.mockResolvedValue({ enabled: true, queue: [], localHistory: [], deliveryHealth: null });
  await client.invalidateQueries({ queryKey: ["ritual-local"] });
  await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
});
it("does not present stale enabled state as current when refresh fails", async () => {
  invoke.mockResolvedValue({ enabled: true, queue: [], localHistory: [], deliveryHealth: null });
  const client = mount();
  await screen.findByText("Automatic rituals on this Mac: on");
  invoke.mockRejectedValue(new Error("Unavailable"));
  await client.invalidateQueries({ queryKey: ["ritual-local"] });
  expect(await screen.findByText("Automatic rituals on this Mac: unavailable")).toBeInTheDocument();
});

it("keeps the signed-out recovery surface empty when no private changes remain", async () => {
  invoke.mockResolvedValue({ enabled: true, queue: [], localHistory: [] });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <RitualLocal recoveryOnly />
    </QueryClientProvider>,
  );
  await waitFor(() => expect(invoke).toHaveBeenCalledWith("ritual_local", { discard: false }));
  expect(view.container).toBeEmptyDOMElement();
});

it("offers signed-out recovery without rendering private answers or delivery status", async () => {
  invoke.mockResolvedValue({
    enabled: true,
    recovery: true,
    queue: [{ value: "Private journal text" }],
    localHistory: [],
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <RitualLocal recoveryOnly />
    </QueryClientProvider>,
  );
  expect(await screen.findByRole("button", { name: "Export pending changes" })).toBeInTheDocument();
  expect(screen.queryByText(/Private journal text/)).not.toBeInTheDocument();
  expect(screen.queryByText(/Automatic rituals on this Mac/)).not.toBeInTheDocument();
  expect(screen.queryByText("Inspect pending changes")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Discard pending changes" }));
  expect(invoke).not.toHaveBeenCalledWith("ritual_local", { discard: true });
  invoke.mockResolvedValue({ enabled: false, queue: [], localHistory: [] });
  fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
  await waitFor(() =>
    expect(
      screen.queryByRole("button", { name: "Export pending changes" }),
    ).not.toBeInTheDocument(),
  );
  expect(invoke).toHaveBeenCalledWith("ritual_local", { discard: true });
});

it("shows quarantined-storage recovery while signed out even with an empty queue", async () => {
  invoke.mockResolvedValue({ enabled: false, storageWarning: true, queue: [], localHistory: [] });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <RitualLocal recoveryOnly />
    </QueryClientProvider>,
  );
  expect(await screen.findByRole("alert")).toHaveTextContent("encrypted original was preserved");
  expect(screen.queryByRole("button", { name: "Export pending changes" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Discard pending changes" }));
  expect(screen.getByText(/Permanently discard the unreadable recovery copy/)).toBeInTheDocument();
  expect(invoke).not.toHaveBeenCalledWith("ritual_local", { discard: true });
  invoke.mockResolvedValue({ enabled: false, storageWarning: false, queue: [], localHistory: [] });
  fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
  await waitFor(() =>
    expect(screen.queryByText("Saved ritual data needs recovery")).not.toBeInTheDocument(),
  );
  expect(invoke).toHaveBeenCalledWith("ritual_local", { discard: true });
});
