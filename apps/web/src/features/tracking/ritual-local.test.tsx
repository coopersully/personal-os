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
