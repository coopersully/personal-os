// @vitest-environment jsdom
import { act, screen, waitFor } from "@testing-library/react";
import { vi } from "vitest";

const mounted = vi.hoisted(() => ({ unmount: undefined as (() => void) | undefined }));
vi.mock("react-dom/client", async (original) => {
  const actual = await original<typeof import("react-dom/client")>();
  return {
    ...actual,
    createRoot: (...args: Parameters<typeof actual.createRoot>) => {
      const root = actual.createRoot(...args);
      mounted.unmount = () => root.unmount();
      return root;
    },
  };
});

it("boots the account-free design preview with system appearance and sample-only controls", async () => {
  const wasDark = document.documentElement.classList.contains("dark");
  const colorScheme = document.documentElement.style.colorScheme;
  const root = document.createElement("div");
  root.id = "root";
  document.body.append(root);
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query === "(prefers-color-scheme: dark)",
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: () => true,
  }));
  try {
    await act(async () => {
      await import("./browser-preview");
    });
    expect(
      await screen.findByRole("heading", { name: "Active cards", level: 1 }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Sample cards · no account required/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Gather" })).toBeDisabled();
    expect(screen.getByTitle("Interactive active task and reminder preview")).toHaveAttribute(
      "src",
      "/active-cards-playground.html?embedded=1",
    );
    expect(document.documentElement).toHaveClass("dark");
    expect(document.documentElement.style.colorScheme).toBe("dark");
    const frame = screen.getByTitle(
      "Interactive active task and reminder preview",
    ) as HTMLIFrameElement;
    const frameWindow = frame.contentWindow;
    if (!frameWindow) throw new Error("Preview frame is missing");
    const messages = vi.spyOn(frameWindow, "postMessage");
    act(() =>
      window.dispatchEvent(
        new MessageEvent("message", {
          origin: window.location.origin,
          source: frameWindow,
          data: { type: "nohmi:active-cards-ready" },
        }),
      ),
    );
    expect(screen.getByRole("button", { name: "Gather" })).toBeEnabled();
    await waitFor(() =>
      expect(messages).toHaveBeenCalledWith(
        expect.objectContaining({
          command: "preferences",
          theme: "dark",
        }),
        window.location.origin,
      ),
    );
    expect(fetch).not.toHaveBeenCalled();
  } finally {
    act(() => mounted.unmount?.());
    root.remove();
    document.documentElement.classList.toggle("dark", wasDark);
    document.documentElement.style.colorScheme = colorScheme;
    vi.unstubAllGlobals();
  }
});
