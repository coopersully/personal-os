// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { LocationMap } from "./location-map";

afterEach(() => vi.unstubAllEnvs());
it("keeps attribution and a bounded fallback without a public key", () => {
  vi.stubEnv("VITE_CARTO_API_KEY", "");
  render(<LocationMap coordinates={{ latitude: 40.7, longitude: -74 }} mode="preview" />);
  expect(screen.getByText("Map unavailable.")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "© CARTO" })).toHaveAttribute(
    "href",
    "https://carto.com/attributions",
  );
  expect(screen.queryByRole("button", { name: "Zoom in" })).not.toBeInTheDocument();
});
it("keeps attribution accessible outside the decorative background", () => {
  vi.stubEnv("VITE_CARTO_API_KEY", "");
  render(<LocationMap coordinates={{ latitude: 40.7, longitude: -74 }} mode="background" />);
  expect(screen.getByRole("link", { name: "© OpenStreetMap contributors" })).toBeVisible();
  expect(screen.queryByText("Map unavailable.")).not.toBeInTheDocument();
});
