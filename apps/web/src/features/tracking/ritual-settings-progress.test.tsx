// @vitest-environment jsdom
import type { RitualDefinition, RitualOccurrence } from "@personal-os/domain";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import { SettingsFeedbackContext } from "../../lib/settings-feedback";
import { RitualSettingsProgress } from "./ritual-settings-progress";

const mocks = vi.hoisted(() => ({ history: vi.fn() }));
vi.mock("../../api.js", () => ({ api: { listRitualHistory: mocks.history } }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), dismiss: vi.fn() } }));
const today = new Date().toISOString().slice(0, 10);
const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
const definition: RitualDefinition = {
  id: "morning",
  kind: "morning",
  title: "Morning ritual",
  revision: 1,
  enabled: true,
  enabledAt: "2020-01-01T00:00:00Z",
  time: "06:00",
  timeZone: "UTC",
  steps: [{ id: "water", kind: "checkbox", label: "Water" }],
};
const completed = (date: string, ritualId = definition.id) =>
  ({
    id: `${ritualId}-${date}`,
    ritualId,
    scheduledLocalDate: date,
    status: "completed",
    definition,
  }) as RitualOccurrence;
function mount() {
  return render(
    <SettingsFeedbackContext.Provider value={true}>
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <RitualSettingsProgress definition={definition} />
      </QueryClientProvider>
    </SettingsFeedbackContext.Provider>,
  );
}
beforeEach(() => vi.resetAllMocks());
afterEach(cleanup);
it("loads all history pages and counts only this ritual's completed days", async () => {
  mocks.history
    .mockResolvedValueOnce({
      items: [completed(yesterday), completed(today, "other")],
      nextCursor: "second",
    })
    .mockResolvedValueOnce({ items: [completed(today)], nextCursor: null });
  mount();
  expect(screen.getByText("Loading progress…")).toBeInTheDocument();
  expect(await screen.findByText("2-day streak")).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "2 of the past 7 days completed" }),
  ).toBeInTheDocument();
  expect(mocks.history).toHaveBeenNthCalledWith(1, undefined, { kind: "morning", dateTo: today });
  expect(mocks.history).toHaveBeenNthCalledWith(2, "second", { kind: "morning", dateTo: today });
});
it("keeps an uncompleted day at zero without counting another ritual", async () => {
  mocks.history.mockResolvedValue({ items: [completed(today, "other")], nextCursor: null });
  mount();
  expect(await screen.findByText("0-day streak")).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "0 of the past 7 days completed" }),
  ).toBeInTheDocument();
});
it("reports progress load failure through Sonner and retries without inventing a zero streak", async () => {
  mocks.history
    .mockRejectedValueOnce(new Error("Private provider detail"))
    .mockResolvedValue({ items: [], nextCursor: null });
  mount();
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith(
      "Couldn’t load ritual progress.",
      expect.objectContaining({
        action: expect.objectContaining({ label: "Try again" }),
      }),
    ),
  );
  expect(screen.queryByText("0-day streak")).not.toBeInTheDocument();
  expect(screen.queryByText("Couldn’t load ritual progress.")).not.toBeInTheDocument();
  expect(screen.queryByText("Private provider detail")).not.toBeInTheDocument();
  const options = vi.mocked(toast.error).mock.calls[0]![1]!;
  await act(async () => {
    (options.action as unknown as { onClick: () => void }).onClick();
  });
  expect(await screen.findByText("0-day streak")).toBeInTheDocument();
  expect(toast.dismiss).toHaveBeenCalled();
});
