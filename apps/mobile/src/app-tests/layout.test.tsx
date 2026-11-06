// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { afterEach, expect, it, vi } from "vitest";
import RootLayout from "../app/_layout";

vi.mock("react", async () => {
  const { createRequire } = await import("node:module");
  return createRequire(`${process.cwd()}/package.json`)("react");
});
vi.mock("react-native", () => import("../../test/native"));
vi.mock("react-native-gesture-handler", () => ({
  GestureHandlerRootView: ({ children }: PropsWithChildren) => <div>{children}</div>,
}));
vi.mock("expo-status-bar", () => ({ StatusBar: () => null }));
vi.mock("../components/app-toaster", () => ({ AppToaster: () => <div data-testid="feedback" /> }));
const h = vi.hoisted(() => ({
  status: "checking",
  user: undefined as { id: string } | undefined,
  restore: vi.fn(),
  error: vi.fn(),
  mounts: [] as string[],
}));
vi.mock("../features/auth/context", () => ({
  AuthProvider: ({ children }: PropsWithChildren) => <>{children}</>,
  useAuth: () => ({ state: { status: h.status, user: h.user }, session: { restore: h.restore } }),
}));
vi.mock("../features/tasks/data", async () => {
  const { useEffect } = await import("react");
  return {
    MobileDataProvider: ({ children }: PropsWithChildren) => {
      useEffect(() => {
        const owner = h.user?.id ?? "signed-out";
        h.mounts.push(owner);
        return () => {
          h.mounts.push(`clear:${owner}`);
        };
      }, []);
      return <>{children}</>;
    },
  };
});
vi.mock("sonner-native", () => ({ toast: { error: h.error } }));
vi.mock("expo-router", () => ({
  Stack: Object.assign(({ children }: PropsWithChildren) => <>{children}</>, {
    Protected: ({ guard, children }: PropsWithChildren<{ guard: boolean }>) =>
      guard ? <>{children}</> : null,
    Screen: ({ name }: { name: string }) => <span data-testid="route">{name}</span>,
  }),
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  h.mounts = [];
});
it("blocks protected routes while checking or offline and reports failed retries through Sonner", async () => {
  h.status = "checking";
  const { rerender } = render(<RootLayout />);
  expect(screen.getByRole("progressbar")).toBeVisible();
  expect(screen.queryAllByTestId("route")).toHaveLength(0);
  expect(screen.getByTestId("feedback")).toBeVisible();
  h.status = "unavailable";
  h.restore.mockRejectedValueOnce(new Error("offline"));
  rerender(<RootLayout />);
  fireEvent.click(screen.getByRole("button", { name: "Retry connection" }));
  await waitFor(() =>
    expect(h.error).toHaveBeenCalledWith("Couldn’t check your session. Please try again."),
  );
  expect(screen.queryByText("offline")).not.toBeInTheDocument();
  expect(screen.queryAllByTestId("route")).toHaveLength(0);
});
it("admits only the correct routes and remounts account data when the owner changes", () => {
  h.status = "signedOut";
  h.user = undefined;
  const { rerender } = render(<RootLayout />);
  expect(screen.getAllByTestId("route").map((node) => node.textContent)).toEqual(["sign-in"]);
  h.status = "signedIn";
  h.user = { id: "one" };
  rerender(<RootLayout />);
  expect(screen.queryByText("sign-in")).not.toBeInTheDocument();
  expect(screen.getByText("task-editor")).toBeVisible();
  expect(screen.getByText("(workspaces)")).toBeVisible();
  h.user = { id: "two" };
  rerender(<RootLayout />);
  expect(h.mounts).toEqual(["signed-out", "clear:signed-out", "one", "clear:one", "two"]);
  h.status = "signedOut";
  h.user = undefined;
  rerender(<RootLayout />);
  expect(h.mounts).toContain("clear:two");
  expect(screen.queryByText("task-editor")).not.toBeInTheDocument();
});
