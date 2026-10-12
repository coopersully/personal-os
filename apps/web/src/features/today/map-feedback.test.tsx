// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { LocationMap } from "./location-map";

vi.mock("@/components/ui/map", () => ({
  Map: ({ onFailure, onReady }: { onFailure: () => void; onReady: () => void }) => (
    <>
      <button type="button" onClick={onFailure}>
        Simulate provider error
      </button>
      <button type="button" onClick={onReady}>
        Simulate map ready
      </button>
    </>
  ),
}));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
it("reports an explicit map retry in one Sonner toast without inline action-result copy", async () => {
  vi.stubEnv("VITE_CARTO_API_KEY", "public-example");
  const loading = vi.spyOn(toast, "loading").mockReturnValue("map-retry");
  const success = vi.spyOn(toast, "success").mockReturnValue("map-retry");
  const error = vi.spyOn(toast, "error").mockReturnValue("map-retry");
  render(<LocationMap coordinates={{ latitude: 40, longitude: -74 }} mode="preview" />);
  await userEvent.click(await screen.findByRole("button", { name: "Simulate provider error" }));
  expect(error).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(loading).toHaveBeenCalledWith("Loading map…");
  await userEvent.click(await screen.findByRole("button", { name: "Simulate map ready" }));
  expect(success).toHaveBeenCalledWith("Map loaded.", { id: "map-retry" });
  expect(screen.queryByText("Map loaded.")).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Simulate provider error" }));
  await userEvent.click(screen.getByRole("button", { name: "Retry" }));
  await userEvent.click(await screen.findByRole("button", { name: "Simulate provider error" }));
  expect(error).toHaveBeenCalledWith("Could not load the map.", { id: "map-retry" });
  expect(screen.queryByText("Could not load the map.")).not.toBeInTheDocument();
});
