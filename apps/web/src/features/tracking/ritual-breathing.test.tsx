// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { breathingMoment, RitualBreathing } from "./ritual-breathing.js";

const advance = (seconds: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(seconds * 1000);
  });
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
it("maps each second to its round, phase, and countdown", () => {
  expect(breathingMoment(0)).toMatchObject({
    round: 1,
    remaining: 4,
    phase: { label: "Breathe in" },
  });
  expect(breathingMoment(3)).toMatchObject({
    round: 1,
    remaining: 1,
    phase: { label: "Breathe in" },
  });
  expect(breathingMoment(4)).toMatchObject({ round: 1, remaining: 4, phase: { label: "Hold" } });
  expect(breathingMoment(8)).toMatchObject({
    round: 1,
    remaining: 6,
    phase: { label: "Breathe out" },
  });
  expect(breathingMoment(13)).toMatchObject({
    round: 1,
    remaining: 1,
    phase: { label: "Breathe out" },
  });
  expect(breathingMoment(14)).toMatchObject({
    round: 2,
    remaining: 4,
    phase: { label: "Breathe in" },
  });
});
it("guides in, hold, and out for four rounds, then rests and can start again", async () => {
  render(<RitualBreathing />);
  expect(screen.getByText("In, hold, out")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Start breathing exercise" }));
  expect(screen.getByText("Breathe in")).toBeInTheDocument();
  expect(screen.getByText("Round 1 of 4")).toBeInTheDocument();
  expect(screen.getByText("4")).toBeInTheDocument();
  await advance(1);
  expect(screen.getByText("3")).toBeInTheDocument();
  await advance(3);
  expect(screen.getByText("Hold")).toBeInTheDocument();
  await advance(4);
  expect(screen.getByText("Breathe out")).toBeInTheDocument();
  expect(screen.getByText("6")).toBeInTheDocument();
  await advance(6);
  expect(screen.getByText("Round 2 of 4")).toBeInTheDocument();
  expect(screen.getByText("Breathe in")).toBeInTheDocument();
  await advance(42);
  expect(screen.getByText("Nicely done")).toBeInTheDocument();
  expect(screen.queryByText(/Round \d of 4/)).not.toBeInTheDocument();
  // Finished exercises stop their timer instead of counting on.
  await advance(30);
  expect(screen.getByText("Nicely done")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Start breathing exercise again" }));
  expect(screen.getByText("Round 1 of 4")).toBeInTheDocument();
});
it("stops on request and returns to rest", async () => {
  render(<RitualBreathing />);
  fireEvent.click(screen.getByRole("button", { name: "Start breathing exercise" }));
  await advance(5);
  expect(screen.getByText("Hold")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Stop breathing exercise" }));
  expect(screen.getByText("In, hold, out")).toBeInTheDocument();
  await advance(10);
  expect(screen.getByText("In, hold, out")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Start breathing exercise" })).toBeInTheDocument();
});
