// @vitest-environment jsdom

import type { WeatherSnapshot } from "@personal-os/domain";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { TodayBackground } from "./background";

const backdrop = vi.hoisted(() => vi.fn());
vi.mock("@/components/ui/liquid-glass", () => ({ useMaterialBackdrop: () => backdrop }));
vi.mock("./location-map", () => ({ LocationMap: () => <div>Local map</div> }));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  backdrop.mockClear();
});
it("leaves Default and unavailable decorative backgrounds empty", () => {
  const view = render(
    <TodayBackground mode="default" weather={undefined} location={null} timeZone="UTC" />,
  );
  expect(view.container).toBeEmptyDOMElement();
  view.rerender(
    <TodayBackground mode="weather" weather={undefined} location={null} timeZone="UTC" />,
  );
  expect(view.container).toBeEmptyDOMElement();
  view.rerender(<TodayBackground mode="map" weather={undefined} location={null} timeZone="UTC" />);
  expect(view.container).toBeEmptyDOMElement();
});
it("composes the local map without requesting location itself", () => {
  render(
    <TodayBackground
      mode="map"
      weather={undefined}
      location={{ latitude: 40, longitude: -73 }}
      timeZone="UTC"
    />,
  );
  expect(screen.getByText("Local map")).toBeInTheDocument();
});
it("creates a local weather optical still and releases it on unmount", () => {
  const context = {
    createLinearGradient: () => ({ addColorStop: vi.fn() }),
    fillStyle: "",
    fillRect: vi.fn(),
  };
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
    context as unknown as CanvasRenderingContext2D,
  );
  vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue("data:image/png;base64,local");
  const weather = {
    observedAt: "2026-10-14T12:00:00Z",
    condition: "Partly cloudy",
  } as WeatherSnapshot;
  const view = render(
    <TodayBackground mode="weather" weather={weather} location={null} timeZone="UTC" />,
  );
  const image = view.container.querySelector("img")!;
  expect(image).toHaveAttribute("src", "data:image/png;base64,local");
  expect(image).toHaveAttribute("aria-hidden", "true");
  fireEvent.load(image);
  expect(backdrop).toHaveBeenCalledWith(image);
  view.unmount();
  expect(backdrop).toHaveBeenLastCalledWith(null);
});
it("keeps weather available when canvas rendering is unsupported", () => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  const view = render(
    <TodayBackground
      mode="weather"
      weather={{ observedAt: "2026-10-14T22:00:00Z", condition: "Clear" } as WeatherSnapshot}
      location={null}
      timeZone="UTC"
    />,
  );
  expect(view.container.querySelector(".today-background--weather")).toHaveAttribute(
    "data-period",
    "night",
  );
  expect(backdrop).not.toHaveBeenCalledWith(expect.any(HTMLImageElement));
});
