// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const desktop = vi.hoisted(() => ({ value: false, open: vi.fn() }));
vi.mock("./updates.js", () => ({ DesktopUpdates: () => null }));
vi.mock("./bridge.js", () => ({ isDesktop: () => desktop.value }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: desktop.open }));
const read = vi.hoisted(() => vi.fn());
vi.mock("../../api.js", () => ({ api: { getDesktopRelease: read } }));

import { DesktopDownloads } from "./downloads.js";

function mount() {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter>
        <DesktopDownloads standalone />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
afterEach(cleanup);
beforeEach(() => {
  read.mockReset();
  desktop.value = false;
  desktop.open.mockReset().mockResolvedValue(undefined);
});
it("shows actual published versions and both architecture downloads", async () => {
  read.mockResolvedValue({
    status: "available",
    release: {
      version: "0.2.0",
      publishedAt: "2026-09-30T12:00:00Z",
      notes: "Release notes",
      releaseUrl: "https://github.com/coopersully/personal-os/releases/tag/v0.2.0",
      installers: [
        { architecture: "aarch64", url: "https://example.com/arm.dmg" },
        { architecture: "x86_64", url: "https://example.com/intel.dmg" },
      ],
    },
  });
  mount();
  expect(await screen.findByText("Version 0.2.0 · macOS 14 or later")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Download for Intel" })).toHaveAttribute(
    "href",
    "https://example.com/intel.dmg",
  );
  expect(screen.getByRole("link", { name: "Download for Apple Silicon" })).toBeInTheDocument();
});
it.each([
  ["not_published", "The first signed desktop release is being prepared"],
  ["disabled", "Ask your server operator for a matching desktop installer"],
])("keeps %s honest", async (status, message) => {
  read.mockResolvedValue({ status, release: null });
  mount();
  expect(await screen.findByText(message)).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: /Download for/ })).not.toBeInTheDocument();
});
it("retries release lookup failures without inventing downloads", async () => {
  read
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValue({ status: "not_published", release: null });
  mount();
  fireEvent.click(await screen.findByRole("button", { name: "Retry" }));
  await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
});

it("opens official release links in the system browser in the desktop app", async () => {
  desktop.value = true;
  read.mockResolvedValue({
    status: "available",
    release: {
      version: "0.2.0",
      publishedAt: "2026-09-30T12:00:00Z",
      notes: "",
      releaseUrl: "https://github.com/coopersully/personal-os/releases/tag/v0.2.0",
      installers: [],
    },
  });
  mount();
  fireEvent.click(await screen.findByRole("link", { name: "View release on GitHub" }));
  expect(desktop.open).toHaveBeenCalledWith(
    "https://github.com/coopersully/personal-os/releases/tag/v0.2.0",
  );
  expect(screen.getByText("No release notes were provided")).toBeInTheDocument();
});
