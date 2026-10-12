// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { RitualOverlay } from "./ritual-overlay.js";

const mocks = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("../desktop/ritual-bridge.js", () => ({
  readRitualState: mocks.read,
  ritualDeviceId: () => "test",
  submitRitualAction: vi.fn(),
  submitRitualResponse: vi.fn(),
}));
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
it("unmounts private answers when the signed-in state becomes unavailable", async () => {
  vi.useFakeTimers();
  mocks.read
    .mockResolvedValueOnce({
      current: {
        id: "a",
        status: "pending",
        revision: 1,
        definition: { kind: "morning", title: "Private greeting", steps: [] },
        responses: [],
      },
      syncStatus: "saved",
    })
    .mockRejectedValue(new Error("Sign in to use rituals."));
  await act(async () => {
    render(<RitualOverlay />);
  });
  expect(screen.getByText("Private greeting")).toBeInTheDocument();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000);
  });
  expect(screen.queryByText("Private greeting")).not.toBeInTheDocument();
});
