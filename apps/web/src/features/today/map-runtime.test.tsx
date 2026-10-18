// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
import { Map as LocationCanvas } from "@/components/ui/map";

const fake = vi.hoisted(() => ({
  handlers: new Map<string, () => void>(),
  remove: vi.fn(),
  disconnect: vi.fn(),
  setWorkerUrl: vi.fn(),
  marker: vi.fn(),
  constructor: vi.fn(),
}));
vi.mock("maplibre-gl", () => ({
  setWorkerUrl: fake.setWorkerUrl,
  Map: class {
    constructor(options: unknown) {
      fake.constructor(options);
    }
    once(event: string, callback: () => void) {
      fake.handlers.set(event, callback);
    }
    on(event: string, callback: () => void) {
      fake.handlers.set(event, callback);
    }
    off() {}
    remove = fake.remove;
    resize() {}
    zoomIn() {}
    zoomOut() {}
  },
  Marker: class {
    constructor() {
      fake.marker();
    }
    setLngLat() {
      return this;
    }
    addTo() {
      return this;
    }
  },
}));
beforeEach(() => {
  vi.useFakeTimers();
  fake.handlers.clear();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect = fake.disconnect;
    },
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
it("uses same-origin workers, releases its instance and cancels the bounded load timer", () => {
  const onFailure = vi.fn();
  const view = render(
    <LocationCanvas
      longitude={-74}
      latitude={40}
      interactive
      apiKey="public"
      onFailure={onFailure}
    />,
  );
  expect(fake.setWorkerUrl).toHaveBeenCalledWith(
    expect.stringContaining("/maplibre/6.14.0/maplibre-gl-worker.mjs"),
  );
  expect(fake.setWorkerUrl.mock.calls[0]?.[0]).not.toContain("unpkg");
  act(() => fake.handlers.get("load")?.());
  expect(screen.getByRole("button", { name: "Zoom in" })).toBeVisible();
  act(() => vi.advanceTimersByTime(10000));
  expect(onFailure).not.toHaveBeenCalled();
  view.unmount();
  expect(fake.remove).toHaveBeenCalledOnce();
  expect(fake.disconnect).toHaveBeenCalledOnce();
});
it("fails a stalled background within ten seconds and omits its precise marker and controls", () => {
  const onFailure = vi.fn();
  const view = render(
    <LocationCanvas
      longitude={-74}
      latitude={40}
      interactive={false}
      apiKey="public"
      onFailure={onFailure}
    />,
  );
  expect(fake.marker).not.toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: "Zoom in" })).not.toBeInTheDocument();
  act(() => vi.advanceTimersByTime(10000));
  expect(onFailure).toHaveBeenCalledOnce();
  view.unmount();
  expect(fake.remove).toHaveBeenCalledOnce();
});
it("falls back when WebGL construction throws", () => {
  fake.constructor.mockImplementationOnce(() => {
    throw new Error("WebGL unavailable");
  });
  const onFailure = vi.fn();
  render(
    <LocationCanvas
      longitude={-74}
      latitude={40}
      interactive
      apiKey="public"
      onFailure={onFailure}
    />,
  );
  expect(onFailure).toHaveBeenCalledOnce();
});
