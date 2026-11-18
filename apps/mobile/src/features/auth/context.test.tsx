// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AuthProvider, useAuth } from "./context";

vi.mock("react", async () => {
  const { createRequire } = await import("node:module");
  return createRequire(`${process.cwd()}/package.json`)("react");
});
const h = vi.hoisted(() => ({
  restore: vi.fn(),
  revalidate: vi.fn(),
  remove: vi.fn(),
  onState: undefined as undefined | ((state: unknown) => void),
  onApp: undefined as undefined | ((state: string) => void),
  error: vi.fn(),
}));
vi.mock("expo/fetch", () => ({ fetch: vi.fn() }));
vi.mock("./storage", () => ({ sessionStorage: vi.fn() }));
vi.mock("./session", () => ({
  resolveApiOrigin: (v: string) => v,
  createSession: ({ onChange }: { onChange: (state: unknown) => void }) => {
    h.onState = onChange;
    return h;
  },
}));
vi.mock("react-native", () => ({
  AppState: {
    addEventListener: (_event: string, listener: (state: string) => void) => {
      h.onApp = listener;
      return { remove: h.remove };
    },
  },
}));
vi.mock("sonner-native", () => ({ toast: h }));
function Consumer() {
  return <span>{useAuth().state.status}</span>;
}
beforeEach(() => {
  vi.clearAllMocks();
  h.restore.mockReset().mockResolvedValue(undefined);
  h.revalidate.mockReset().mockResolvedValue(undefined);
});
afterEach(cleanup);
it("restores once, exposes accepted identity, revalidates on foreground and removes the listener", async () => {
  const { unmount } = render(
    <AuthProvider>
      <Consumer />
    </AuthProvider>,
  );
  expect(screen.getByText("checking")).toBeVisible();
  expect(h.restore).toHaveBeenCalledOnce();
  act(() => h.onState?.({ status: "signedIn", user: { id: "person" } }));
  expect(screen.getByText("signedIn")).toBeVisible();
  await act(async () => {
    h.onApp?.("background");
    h.onApp?.("active");
  });
  expect(h.revalidate).toHaveBeenCalledOnce();
  unmount();
  expect(h.remove).toHaveBeenCalledOnce();
});
it("routes restore and foreground failures to Sonner", async () => {
  h.restore.mockRejectedValue(new Error("offline"));
  h.revalidate.mockRejectedValue(new Error("offline"));
  render(
    <AuthProvider>
      <Consumer />
    </AuthProvider>,
  );
  await waitFor(() =>
    expect(h.error).toHaveBeenCalledWith(
      "Couldn’t check your session. Check your connection and try again.",
    ),
  );
  await act(async () => h.onApp?.("active"));
  expect(h.error).toHaveBeenCalledWith("Couldn’t refresh your session. Check your connection.");
  expect(screen.queryByText(/Couldn’t/)).not.toBeInTheDocument();
});
it("fails explicitly when a consumer has no authentication provider", () => {
  expect(() => render(<Consumer />)).toThrow("AuthProvider is missing.");
});
