// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { toast } from "sonner";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DesktopRailUtilities } from "./rail-utilities";

const mocks = vi.hoisted(() => ({
  desktop: true,
  status: vi.fn(),
  settings: vi.fn(),
  install: vi.fn(),
}));
vi.mock("./bridge", () => ({ isDesktop: () => mocks.desktop, getDesktopSettings: mocks.settings }));
vi.mock("./updates", () => ({ useDesktopUpdateStatus: () => ({ data: mocks.status() }) }));
vi.mock("./update-bridge", () => ({ restartForUpdate: mocks.install }));
vi.mock("sonner", () => ({
  toast: { loading: vi.fn(() => "install-toast"), success: vi.fn(), error: vi.fn() },
}));
const ready = { phase: "ready", availableVersion: "0.2.0" };
function mount(cache = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  return render(
    <MemoryRouter>
      <QueryClientProvider client={cache}>
        <DesktopRailUtilities />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.desktop = true;
  mocks.status.mockReturnValue(ready);
  mocks.settings.mockResolvedValue({ settings: { petEnabled: true, petColor: "#a988ef" } });
  mocks.install.mockResolvedValue(undefined);
});
afterEach(cleanup);
it("orders the update before the configured pet and opens pet settings", async () => {
  mount();
  const pet = await screen.findByRole("link", { name: "Pet settings" });
  const update = screen.getByRole("button", { name: "Install nohmi 0.2.0" });
  expect(update.compareDocumentPosition(pet) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(pet).toHaveAttribute("href", "/settings?section=pet");
  expect(pet.querySelector(".pet-portrait")).toHaveStyle("--pet-color: #a988ef");
  fireEvent.click(update);
  await waitFor(() => expect(mocks.install).toHaveBeenCalledOnce());
  expect(toast.loading).toHaveBeenCalledWith("Installing update and restarting…");
  await waitFor(() =>
    expect(toast.success).toHaveBeenCalledWith("Update installation requested.", {
      id: "install-toast",
    }),
  );
  expect(screen.queryByText("Update installation requested.")).not.toBeInTheDocument();
});
it("reports install failure in the same toast and permits retry", async () => {
  mocks.install.mockRejectedValue(new Error("native failure"));
  mount();
  const button = screen.getByRole("button", { name: "Install nohmi 0.2.0" });
  fireEvent.click(button);
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith(
      "Couldn’t install the update. Open desktop settings to retry.",
      { id: "install-toast" },
    ),
  );
  expect(button).toBeEnabled();
  expect(screen.queryByText(/Couldn’t install the update/)).not.toBeInTheDocument();
});
it("prevents duplicate install while pending", async () => {
  mocks.install.mockReturnValue(new Promise(() => {}));
  mount();
  const button = screen.getByRole("button", { name: "Install nohmi 0.2.0" });
  fireEvent.click(button);
  fireEvent.click(button);
  expect(button).toBeDisabled();
  expect(mocks.install).toHaveBeenCalledOnce();
});
it.each(["downloading", "installing"])("shows a disabled update during %s", (phase) => {
  mocks.status.mockReturnValue({ ...ready, phase });
  mount();
  expect(screen.getByRole("button", { name: "Install nohmi 0.2.0" })).toBeDisabled();
  expect(mocks.install).not.toHaveBeenCalled();
});
it("hides unavailable updates and disabled pets", async () => {
  mocks.status.mockReturnValue({ phase: "current", availableVersion: null });
  mocks.settings.mockResolvedValue({ settings: { petEnabled: false } });
  mount();
  await waitFor(() => expect(mocks.settings).toHaveBeenCalled());
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
  expect(screen.queryByRole("link")).not.toBeInTheDocument();
});
it("never reads desktop settings or displays native controls in a browser", () => {
  mocks.desktop = false;
  mount();
  expect(mocks.settings).not.toHaveBeenCalled();
  expect(screen.queryByRole("link")).not.toBeInTheDocument();
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
});

it.each([
  ["#ffffff", "black"],
  ["#000000", "white"],
])("keeps the native pet face visible on body color %s", async (color, face) => {
  mocks.settings.mockResolvedValue({ settings: { petEnabled: true, petColor: color } });
  mount();
  const pet = await screen.findByRole("link", { name: "Pet settings" });
  expect(pet.querySelector(".pet-portrait")).toHaveStyle(`--pet-face: ${face}`);
});

it("responds immediately to settings saves through the shared desktop cache", async () => {
  mocks.settings.mockResolvedValue({ settings: { petEnabled: false, petColor: "#ffffff" } });
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  mount(cache);
  await waitFor(() => expect(cache.getQueryData(["desktop-settings"])).toBeDefined());
  expect(screen.queryByRole("link", { name: "Pet settings" })).not.toBeInTheDocument();
  act(() => {
    cache.setQueryData(["desktop-settings"], {
      settings: { petEnabled: true, petColor: "#ffffff" },
    });
  });
  expect(await screen.findByRole("link", { name: "Pet settings" })).toBeInTheDocument();
  act(() => {
    cache.setQueryData(["desktop-settings"], {
      settings: { petEnabled: false, petColor: "#ffffff" },
    });
  });
  await waitFor(() =>
    expect(screen.queryByRole("link", { name: "Pet settings" })).not.toBeInTheDocument(),
  );
  expect(mocks.settings).toHaveBeenCalledOnce();
});
