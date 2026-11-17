// @vitest-environment jsdom

import { ApiClientError } from "@personal-os/api-client";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { PropsWithChildren, Ref } from "react";
import type {
  GestureResponderEvent,
  PanResponderCallbacks,
  PanResponderGestureState,
} from "react-native";
import { Animated } from "react-native";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import WorkspaceLayout from "../app/(workspaces)/_layout";
import { MobileDataProvider } from "../features/tasks/data";
import { regionMotion, WorkspaceMotion } from "../navigation/workspace-motion";
import { WorkspaceAddButton } from "./workspace-add-button";
import { WorkspaceDock } from "./workspace-dock";
import { WorkspaceHeader } from "./workspace-header";

vi.mock("expo-status-bar", () => ({ StatusBar: () => null }));
vi.mock("../features/briefing/sky-context", () => ({
  TodaySkyProvider: ({ children }: PropsWithChildren) => <>{children}</>,
  useTodaySky: () => ({ sky: { topColor: "#141f41", chromeDark: true } }),
}));

vi.mock("react", async () => {
  const { createRequire } = await import("node:module");
  return createRequire(`${process.cwd()}/package.json`)("react");
});
vi.mock("@tanstack/react-query", async () => {
  const { createRequire } = await import("node:module");
  return createRequire(`${process.cwd()}/apps/web/package.json`)("@tanstack/react-query");
});
const h = vi.hoisted(() => ({
  path: "/",
  params: {} as { accountSearch?: string; mailSearch?: string },
  accessibilityTap: undefined as undefined | (() => void),
  platform: { OS: "web" },
  reduced: false,
  navigate: vi.fn(),
  setParams: vi.fn(),
  push: vi.fn(),
  selection: vi.fn(),
  logout: vi.fn(),
  loading: vi.fn(() => "session-toast"),
  dismiss: vi.fn(),
  error: vi.fn(),
  success: vi.fn(),
  searchWorkspace: vi.fn(),
  getWorkspaceSettings: vi.fn(),
  keyboard: vi.fn(),
  remove: vi.fn(),
  responders: [] as PanResponderCallbacks[],
  animations: [] as { duration: number; direction: number; useNativeDriver: boolean }[],
  changeReduced: undefined as undefined | ((value: boolean) => void),
}));
vi.mock("expo-router", () => ({
  router: { navigate: h.navigate, push: h.push, setParams: h.setParams },
  usePathname: () => h.path,
  useLocalSearchParams: () => h.params,
  useGlobalSearchParams: () => ({}),
  Stack: () => <div data-testid="page-stack" />,
}));
vi.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 44, bottom: 34 }),
}));
vi.mock("expo-haptics", () => ({ selectionAsync: h.selection }));
vi.mock("sonner-native", () => ({ toast: h }));
vi.mock("../features/auth/context", () => ({
  useOptionalAuth: () => null,
  useAuth: () => ({
    state: { user: { id: "owner", displayName: "Test Person", email: "person@example.test" } },
    session: {
      logout: h.logout,
      api: () => ({
        searchWorkspace: h.searchWorkspace,
        getWorkspaceSettings: h.getWorkspaceSettings,
      }),
    },
  }),
}));
vi.mock("./icons", () => ({
  Icon: ({ name, color, filled }: { name: string; color: string; filled?: boolean }) => (
    <span data-icon={name} data-color={color} data-filled={String(!!filled)} />
  ),
}));
vi.mock("./workspace-picker", () => ({
  WorkspacePicker: ({ selected }: { selected: string }) => (
    <span data-testid="native-picker" data-selected={selected} />
  ),
}));
vi.mock("expo-glass-effect", () => ({
  isLiquidGlassAvailable: () => true,
  GlassView: ({ children }: PropsWithChildren) => <div data-testid="glass">{children}</div>,
}));
vi.mock("react-native", async () => {
  const native = await import("../../test/native");
  const { useEffect, useImperativeHandle } = await import("react");
  type Measure = {
    measureInWindow: (
      callback: (x: number, y: number, width: number, height: number) => void,
    ) => void;
  };
  function Box({
    children,
    ref,
    onLayout,
    ...props
  }: PropsWithChildren<{ ref?: Ref<Measure>; onLayout?: () => void }>) {
    useImperativeHandle(ref, () => ({ measureInWindow: (callback) => callback(0, 60, 256, 64) }));
    useEffect(() => {
      onLayout?.();
    }, [onLayout]);
    return <native.View {...props}>{children}</native.View>;
  }
  function Button(
    props: Parameters<typeof native.Pressable>[0] & {
      onLayout?: (event: { nativeEvent: { layout: { y: number; height: number } } }) => void;
      onHoverIn?: () => void;
      onHoverOut?: () => void;
      onAccessibilityTap?: () => void;
    },
  ) {
    if (props.onAccessibilityTap) h.accessibilityTap = props.onAccessibilityTap;
    useEffect(() => {
      const index = ["today", "tasks", "mail", "finances", "calendar"].findIndex(
        (name) => props.accessibilityLabel === `Open ${name}`,
      );
      if (index >= 0) props.onLayout?.({ nativeEvent: { layout: { y: index * 52, height: 52 } } });
    }, [props.onLayout, props.accessibilityLabel]);
    return <native.Pressable {...props} />;
  }
  class Value {
    constructor(public value: number) {}
    setValue(next: number) {
      this.value = next;
    }
    stopAnimation() {}
    interpolate(input: unknown) {
      return input;
    }
  }
  return {
    ...native,
    View: Box,
    Pressable: Button,
    Platform: h.platform,
    Keyboard: { dismiss: h.keyboard },
    PanResponder: {
      create: (callbacks: PanResponderCallbacks) => {
        h.responders.push(callbacks);
        return { panHandlers: {} };
      },
    },
    Animated: {
      View: Box,
      Value,
      timing: (
        value: Value,
        options: { duration: number; toValue: number; useNativeDriver: boolean },
      ) => ({
        start: (finish: (result: { finished: boolean }) => void) => {
          h.animations.push({
            duration: options.duration,
            direction: value.value,
            useNativeDriver: options.useNativeDriver,
          });
          value.setValue(options.toValue);
          finish({ finished: true });
        },
      }),
    },
    Easing: { bezier: () => (value: number) => value },
    AccessibilityInfo: {
      isReduceMotionEnabled: async () => h.reduced,
      addEventListener: (_event: string, listener: (value: boolean) => void) => {
        h.changeReduced = listener;
        return { remove: h.remove };
      },
    },
  };
});
beforeEach(() => {
  vi.clearAllMocks();
  h.path = "/";
  h.params = {};
  h.platform.OS = "web";
  h.reduced = false;
  h.responders = [];
  h.animations = [];
  h.selection.mockReset().mockResolvedValue(undefined);
  h.logout.mockReset().mockResolvedValue(undefined);
  h.getWorkspaceSettings
    .mockReset()
    .mockResolvedValue({ revision: 1, preferences: { includeArchivedInSearch: true } });
  h.searchWorkspace.mockReset().mockImplementation(async (workspace: string) => page(workspace));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
const result = (id: string, kind: string, title: string, preview: string, state?: string) => ({
  id,
  kind,
  title,
  preview,
  href: "/web-only",
  state: state ?? null,
});
function page(workspace: string) {
  const items = {
    tasks: [
      result("t1", "Task", "Book dentist", "Task · Home ·  · Due Nov 20, 2026"),
      result("l1", "List", "Old chores", "Task list", "Archived"),
    ],
    mail: [
      result("m1", "Conversation", "Dentist invoice", "Dr. Lee billing@example.test · Attached"),
      result("m2", "Conversation", " ", "Someone · Dentist follow-up"),
    ],
    finances: [result("f1", "Transaction", "Dental Group", "USD -120.00 · 2026-11-02 · Checking")],
    calendar: [result("e1", "Event", "Dentist appointment", "Nov 20, 2026 09:00 · Personal · ")],
  }[workspace];
  return { items, nextOffset: workspace === "mail" ? 5 : null, coverage: "synced" };
}
function Shell() {
  return (
    <MobileDataProvider>
      <WorkspaceMotion>
        <WorkspaceHeader />
        <WorkspaceDock />
        <WorkspaceAddButton />
      </WorkspaceMotion>
    </MobileDataProvider>
  );
}
const event = (x = 20, y = 144) =>
  ({ nativeEvent: { pageX: x, pageY: y } }) as GestureResponderEvent;
const gesture = (x = 20, y = 144, dx = 0) =>
  ({ moveX: x, moveY: y, dx, dy: 0 }) as PanResponderGestureState;
it("keeps search mounted while selecting a workspace and shows account/settings destinations", async () => {
  render(<Shell />);
  await act(async () => {});
  const search = screen.getByLabelText("Search today");
  fireEvent.click(screen.getByRole("button", { name: "Switch workspace, today" }));
  expect(screen.getByLabelText("Search today")).toBe(search);
  fireEvent.click(screen.getByRole("button", { name: "Open tasks" }));
  expect(h.navigate).toHaveBeenCalledWith("/tasks");
  expect(screen.queryByRole("button", { name: "Open mail" })).not.toBeInTheDocument();
  for (const [label, path] of [
    ["settings", "/settings"],
    ["workspace settings", "/settings"],
    ["agent settings", "/settings/agents"],
  ]) {
    fireEvent.click(screen.getByRole("button", { name: "Account menu" }));
    expect(screen.getByText("Test Person")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: label }));
    expect(h.navigate).toHaveBeenLastCalledWith(path);
  }
});
it("keeps Tasks search in its live list without a results overlay", async () => {
  h.path = "/tasks";
  render(<Shell />);
  await act(async () => {});
  fireEvent.change(screen.getByLabelText("Search tasks"), { target: { value: "groceries" } });
  expect(screen.getByLabelText("Search tasks")).toHaveValue("groceries");
  expect(screen.queryByRole("button", { name: "Include archive" })).not.toBeInTheDocument();
  await act(async () => new Promise((resolve) => setTimeout(resolve, 300)));
  expect(h.searchWorkspace).not.toHaveBeenCalled();
});
it("searches every workspace from Today one at a time and groups real results by workspace", async () => {
  let running = 0;
  let most = 0;
  h.searchWorkspace.mockImplementation(async (workspace: string) => {
    most = Math.max(most, ++running);
    await new Promise((resolve) => setTimeout(resolve, 5));
    running -= 1;
    return page(workspace);
  });
  render(<Shell />);
  await act(async () => {});
  fireEvent.change(screen.getByLabelText("Search today"), { target: { value: " dentist " } });
  expect(screen.getByRole("progressbar")).toBeVisible();
  await screen.findByRole("heading", { name: "calendar" });
  expect(screen.getAllByRole("heading").map((heading) => heading.textContent)).toEqual([
    "tasks",
    "mail",
    "finances",
    "calendar",
  ]);
  expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  // The API replaces an account's queued search with a newer one, so requests never overlap.
  expect(most).toBe(1);
  expect(h.searchWorkspace.mock.calls.map(([workspace, query]) => [workspace, query])).toEqual(
    ["tasks", "mail", "finances", "calendar"].map((workspace) => [
      workspace,
      { q: "dentist", kind: "content", limit: 5, includeArchived: true },
    ]),
  );
  expect(
    screen.getByRole("button", { name: /Book dentist.*Task · Home · Due Nov 20, 2026/ }),
  ).toBeVisible();
  expect(screen.getByRole("button", { name: /Old chores.*Archived/ })).toBeVisible();
  expect(screen.getByRole("button", { name: /Untitled conversation/ })).toBeVisible();
  expect(screen.getByText("Showing the first 2 in mail. Keep typing to narrow.")).toBeVisible();
  expect(screen.queryByText(/sample/i)).not.toBeInTheDocument();
  expect(h.error).not.toHaveBeenCalled();
});
it("opens the existing screen for a result and closes the search", async () => {
  render(<Shell />);
  await act(async () => {});
  const open = async (name: RegExp) => {
    fireEvent.change(screen.getByLabelText("Search today"), { target: { value: "dentist" } });
    fireEvent.click(await screen.findByRole("button", { name }));
    expect(screen.getByLabelText("Search today")).toHaveValue("");
    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
  };
  await open(/Dentist appointment/);
  expect(h.push).toHaveBeenLastCalledWith({ pathname: "/calendar-event", params: { id: "e1" } });
  await open(/Book dentist/);
  expect(h.push).toHaveBeenLastCalledWith({
    pathname: "/task-editor",
    params: { id: "t1", kind: "task" },
  });
  await open(/Dentist invoice/);
  expect(h.navigate).toHaveBeenLastCalledWith({
    pathname: "/mail",
    params: { mailSearch: "Dentist invoice" },
  });
  await open(/Dental Group/);
  expect(h.push).toHaveBeenLastCalledWith({
    pathname: "/finance-transaction",
    params: { id: "f1" },
  });
  expect(h.keyboard).toHaveBeenCalled();
});
it("searches only the current workspace elsewhere and honors the archive preference and toggle", async () => {
  h.path = "/calendar";
  h.getWorkspaceSettings.mockResolvedValue({
    revision: 1,
    preferences: { includeArchivedInSearch: false },
  });
  render(<Shell />);
  await act(async () => {});
  fireEvent.change(screen.getByLabelText("Search calendar"), { target: { value: "dentist" } });
  await screen.findByRole("heading", { name: "calendar" });
  expect(h.getWorkspaceSettings).toHaveBeenCalledWith("calendar");
  expect(h.searchWorkspace.mock.calls.map(([workspace, query]) => [workspace, query])).toEqual([
    ["calendar", { q: "dentist", kind: "content", limit: 20, includeArchived: false }],
  ]);
  const archive = screen.getByRole("button", { name: "Include archive" });
  expect(archive).toHaveAttribute("aria-pressed", "false");
  fireEvent.click(archive);
  await waitFor(() =>
    expect(h.searchWorkspace).toHaveBeenLastCalledWith(
      "calendar",
      { q: "dentist", kind: "content", limit: 20, includeArchived: true },
      expect.anything(),
    ),
  );
  expect(screen.getByRole("button", { name: "Include archive" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  fireEvent.click(screen.getByRole("button", { name: "Dismiss navigation menu or search" }));
  expect(screen.queryByRole("heading", { name: "calendar" })).not.toBeInTheDocument();
});
it("says which workspaces have no matches", async () => {
  h.searchWorkspace.mockResolvedValue({ items: [], nextOffset: null, coverage: "synced" });
  render(<Shell />);
  await act(async () => {});
  fireEvent.change(screen.getByLabelText("Search today"), { target: { value: "zzz" } });
  expect(
    await screen.findByText("No matches in tasks, mail, finances and calendar."),
  ).toBeVisible();
  expect(screen.queryByRole("heading")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /again/ })).not.toBeInTheDocument();
  expect(h.error).not.toHaveBeenCalled();
});
it("reports a failed workspace through Sonner alone, keeps the other results and retries", async () => {
  h.searchWorkspace.mockImplementation(async (workspace: string) => {
    if (workspace === "mail") throw new Error("offline");
    return page(workspace);
  });
  render(<Shell />);
  await act(async () => {});
  fireEvent.change(screen.getByLabelText("Search today"), { target: { value: "dentist" } });
  await screen.findByRole("heading", { name: "calendar" });
  expect(h.error).toHaveBeenCalledTimes(1);
  expect(h.error).toHaveBeenCalledWith(
    "Couldn’t search mail. Check your connection and try again.",
    { id: "workspace-search" },
  );
  expect(screen.getAllByRole("heading").map((heading) => heading.textContent)).toEqual([
    "tasks",
    "finances",
    "calendar",
  ]);
  // The surface offers the retry but carries no failure or empty copy of its own.
  expect(screen.queryByText(/couldn|unavailable|failed|error|no matches/i)).not.toBeInTheDocument();
  const retry = screen.getByRole("button", { name: "Search mail again" });
  fireEvent.click(retry);
  await waitFor(() => expect(h.error).toHaveBeenCalledTimes(2));
  expect(h.loading).toHaveBeenLastCalledWith("Searching again…", { id: "workspace-search" });
  // The repeated failure replaces the loading toast; nothing claims success.
  expect(h.error).toHaveBeenLastCalledWith(
    "Couldn’t search mail. Check your connection and try again.",
    { id: "workspace-search" },
  );
  expect(h.success).not.toHaveBeenCalled();
  h.searchWorkspace.mockImplementation(async (workspace: string) => page(workspace));
  fireEvent.click(screen.getByRole("button", { name: "Search mail again" }));
  await screen.findByRole("heading", { name: "mail" });
  expect(h.success).toHaveBeenCalledWith("Search updated", { id: "workspace-search" });
  expect(screen.queryByRole("button", { name: "Search mail again" })).not.toBeInTheDocument();
});
it("names every failed workspace in one toast and does not blame the connection for a server answer", async () => {
  h.searchWorkspace.mockRejectedValue(new Error("offline"));
  render(<Shell />);
  await act(async () => {});
  fireEvent.change(screen.getByLabelText("Search today"), { target: { value: "dentist" } });
  await screen.findByRole("button", { name: "Search tasks, mail, finances and calendar again" });
  expect(h.error).toHaveBeenCalledTimes(1);
  expect(h.error).toHaveBeenCalledWith(
    "Couldn’t search tasks, mail, finances and calendar. Check your connection and try again.",
    { id: "workspace-search" },
  );
  h.error.mockClear();
  h.searchWorkspace.mockImplementation(async (workspace: string) => {
    if (workspace === "finances")
      throw new ApiClientError({
        code: "rate_limited",
        message: "Too many requests.",
        status: 429,
      });
    return page(workspace);
  });
  fireEvent.change(screen.getByLabelText("Search today"), { target: { value: "dentists" } });
  await screen.findByRole("button", { name: "Search finances again" });
  expect(h.error).toHaveBeenCalledTimes(1);
  expect(h.error).toHaveBeenCalledWith("Couldn’t search finances. Try again shortly.", {
    id: "workspace-search",
  });
});
it("offers only the retry when every workspace fails", async () => {
  h.path = "/finances";
  h.getWorkspaceSettings.mockRejectedValue(new Error("offline"));
  h.searchWorkspace.mockRejectedValue(new Error("offline"));
  render(<Shell />);
  await act(async () => {});
  fireEvent.change(screen.getByLabelText("Search finances"), { target: { value: "rent" } });
  expect(await screen.findByRole("button", { name: "Search finances again" })).toBeVisible();
  // An unreadable archive preference falls back to the server default rather than blocking search.
  expect(h.searchWorkspace).toHaveBeenCalledWith(
    "finances",
    { q: "rent", kind: "content", limit: 20, includeArchived: true },
    expect.anything(),
  );
  expect(h.error).toHaveBeenCalledTimes(1);
  expect(screen.queryByText(/no matches|couldn/i)).not.toBeInTheDocument();
});
it("holds logout pending, reports a failure without claiming success, and allows retry", async () => {
  let reject!: (error: Error) => void;
  h.logout.mockImplementationOnce(
    () =>
      new Promise((_resolve, fail) => {
        reject = fail;
      }),
  );
  render(<Shell />);
  fireEvent.click(screen.getByRole("button", { name: "Account menu" }));
  fireEvent.click(screen.getByRole("button", { name: "log out" }));
  expect(screen.getByRole("button", { name: "log out" })).toBeDisabled();
  await act(async () => reject(new Error("offline")));
  expect(h.error).toHaveBeenCalledWith("Couldn’t sign out. Check your connection and try again.", {
    id: "session-toast",
  });
  fireEvent.click(screen.getByRole("button", { name: "log out" }));
  await waitFor(() => expect(h.dismiss).toHaveBeenCalledWith("session-toast"));
  expect(h.logout).toHaveBeenCalledTimes(2);
});
it("selects a workspace after hold-and-drag and tolerates unavailable haptic hardware", async () => {
  h.platform.OS = "ios";
  h.selection.mockRejectedValue(new Error("no hardware"));
  render(<Shell />);
  await act(async () => {});
  vi.useFakeTimers();
  const pan = h.responders[0];
  expect(pan.onStartShouldSetPanResponderCapture?.(event(), gesture())).toBe(true);
  act(() => pan.onPanResponderGrant?.(event(), gesture()));
  await act(async () => vi.advanceTimersByTimeAsync(230));
  expect(screen.getByTestId("native-picker")).toBeVisible();
  expect(screen.getByLabelText("Search today")).toBeVisible();
  act(() => pan.onPanResponderMove?.(event(), gesture()));
  expect(screen.getByTestId("native-picker")).toHaveAttribute("data-selected", "tasks");
  await act(async () => pan.onPanResponderRelease?.(event(), gesture()));
  expect(h.navigate).toHaveBeenCalledWith("/tasks");
  expect(h.selection).toHaveBeenCalled();
  expect(screen.queryByTestId("native-picker")).not.toBeInTheDocument();
  expect(pan.onPanResponderTerminationRequest?.(event(), gesture())).toBe(false);
});
it("does not reopen the picker from a hold timer orphaned by a second grant", async () => {
  h.platform.OS = "ios";
  render(<Shell />);
  await act(async () => {});
  vi.useFakeTimers();
  const pan = h.responders[0];
  act(() => pan.onPanResponderGrant?.(event(), gesture()));
  await act(async () => vi.advanceTimersByTimeAsync(100));
  // A second grant before the first hold elapsed must replace its timer, not add another.
  act(() => pan.onPanResponderGrant?.(event(), gesture()));
  act(() => pan.onPanResponderMove?.(event(), gesture(20, 144, 20)));
  await act(async () => pan.onPanResponderRelease?.(event(), gesture()));
  expect(h.navigate).toHaveBeenCalledWith("/tasks");
  expect(screen.queryByTestId("native-picker")).not.toBeInTheDocument();
  await act(async () => vi.advanceTimersByTimeAsync(300));
  expect(screen.queryByTestId("native-picker")).not.toBeInTheDocument();
});
it("drops a pending hold timer when the route changes", async () => {
  h.platform.OS = "ios";
  const view = render(<Shell />);
  await act(async () => {});
  vi.useFakeTimers();
  act(() => h.responders[0].onPanResponderGrant?.(event(), gesture()));
  h.path = "/tasks";
  view.rerender(<Shell />);
  await act(async () => vi.advanceTimersByTimeAsync(300));
  expect(screen.queryByTestId("native-picker")).not.toBeInTheDocument();
});
it("supports quick slide, tap-open selection and cancellation without unintended navigation", async () => {
  render(<Shell />);
  await act(async () => {});
  const pan = h.responders[0],
    menu = h.responders[1];
  act(() => {
    pan.onPanResponderGrant?.(event(), gesture());
    pan.onPanResponderMove?.(event(), gesture(20, 144, 20));
  });
  act(() => pan.onPanResponderTerminate?.(event(), gesture()));
  expect(h.navigate).not.toHaveBeenCalled();
  act(() => {
    pan.onPanResponderGrant?.(event(), gesture());
    pan.onPanResponderRelease?.(event(), gesture());
  });
  expect(screen.getByRole("button", { name: "Open tasks" })).toBeVisible();
  expect(menu.onMoveShouldSetPanResponderCapture?.(event(), gesture())).toBe(true);
  act(() => menu.onPanResponderGrant?.(event(), gesture()));
  act(() => menu.onPanResponderMove?.(event(), gesture()));
  act(() => menu.onPanResponderRelease?.(event(), gesture()));
  expect(h.navigate).toHaveBeenCalledWith("/tasks");
  h.navigate.mockClear();
  fireEvent.click(screen.getByRole("button", { name: "Switch workspace, today" }));
  act(() => menu.onPanResponderRelease?.(event(500, 500), gesture(500, 500)));
  expect(h.navigate).not.toHaveBeenCalled();
});
it("uses vertical workspace motion and horizontal page motion, honoring Reduce Motion", async () => {
  const progress = new Animated.Value(1);
  expect(regionMotion(progress, 20)).toEqual({
    transform: [{ translateY: { inputRange: [-1, 0, 1], outputRange: [-20, 0, 20] } }],
  });
  expect(regionMotion(progress, 24, "x")).toEqual({
    transform: [{ translateX: { inputRange: [-1, 0, 1], outputRange: [-24, 0, 24] } }],
  });
  const { rerender, unmount } = render(<Shell />);
  await act(async () => {});
  fireEvent.click(screen.getByRole("button", { name: "Switch workspace, today" }));
  fireEvent.click(screen.getByRole("button", { name: "Open tasks" }));
  h.path = "/tasks";
  rerender(<Shell />);
  expect(h.animations.at(-1)).toMatchObject({ direction: 1, useNativeDriver: false });
  expect(h.animations.at(-1)?.duration).toBeLessThanOrEqual(180);
  h.path = "/tasks/projects";
  rerender(<Shell />);
  expect(h.animations.at(-1)?.direction).toBe(1);
  h.path = "/tasks";
  rerender(<Shell />);
  expect(h.animations.at(-1)?.direction).toBe(-1);
  act(() => h.changeReduced?.(true));
  const count = h.animations.length;
  fireEvent.click(screen.getByRole("button", { name: "Switch workspace, tasks" }));
  fireEvent.click(screen.getByRole("button", { name: "Open today" }));
  expect(h.navigate).toHaveBeenLastCalledWith("/");
  h.path = "/";
  rerender(<Shell />);
  expect(h.animations).toHaveLength(count);
  unmount();
  expect(h.remove).toHaveBeenCalledOnce();
});
it("offers workspace-specific tabs and contextual capture while leaving previews disabled", async () => {
  h.path = "/tasks";
  const { rerender } = render(<Shell />);
  await act(async () => {});
  fireEvent.click(screen.getByRole("tab", { name: "projects" }));
  expect(h.navigate).toHaveBeenLastCalledWith("/tasks/projects");
  fireEvent.click(screen.getByRole("button", { name: "Add task" }));
  expect(h.push).toHaveBeenLastCalledWith({ pathname: "/task-editor", params: { kind: "task" } });
  for (const [path, kind] of [
    ["/tasks/lists", "list"],
    ["/tasks/projects", "project"],
  ]) {
    h.path = path;
    rerender(<Shell />);
    fireEvent.click(screen.getByRole("button", { name: `Add ${kind}` }));
    expect(h.push).toHaveBeenLastCalledWith({ pathname: "/task-container", params: { kind } });
  }
  h.path = "/tasks/views";
  rerender(<Shell />);
  expect(screen.queryByRole("button", { name: /Add/ })).not.toBeInTheDocument();
  // Compose is not built yet, so neither Mail tab offers an add button.
  for (const path of ["/mail", "/mail/mailboxes"]) {
    h.path = path;
    rerender(<Shell />);
    expect(screen.queryByRole("button", { name: /Compose|Add/ })).not.toBeInTheDocument();
  }
  h.path = "/calendar";
  rerender(<Shell />);
  // Calendar is browse-only until event creation ships; an idle add button would overlay the day.
  expect(screen.queryByRole("button", { name: /Add|Compose/ })).not.toBeInTheDocument();
});
it("routes dock dragging to a page and ignores a release outside its bounds", async () => {
  h.path = "/tasks";
  h.platform.OS = "ios";
  render(<Shell />);
  await act(async () => {});
  const dock = h.responders[2];
  expect(dock.onMoveShouldSetPanResponderCapture?.(event(), gesture(140, 80, 10))).toBe(true);
  await act(async () => {
    dock.onPanResponderGrant?.(event(), gesture(140, 80));
    dock.onPanResponderMove?.(event(), gesture(140, 80));
    dock.onPanResponderRelease?.(event(), gesture(140, 80));
  });
  expect(h.navigate).toHaveBeenLastCalledWith("/tasks/lists");
  h.navigate.mockClear();
  act(() => dock.onPanResponderRelease?.(event(), gesture(500, 500)));
  expect(h.navigate).not.toHaveBeenCalled();
  act(() => dock.onPanResponderTerminate?.(event(), gesture()));
});

it("keeps shared search chrome around the page stack and uses the dock only on web", () => {
  h.path = "/tasks";
  const { rerender } = render(
    <MobileDataProvider>
      <WorkspaceLayout />
    </MobileDataProvider>,
  );
  expect(screen.getByTestId("page-stack")).toBeVisible();
  expect(screen.getByRole("tab", { name: "projects" })).toBeVisible();
  h.platform.OS = "ios";
  rerender(
    <MobileDataProvider>
      <WorkspaceLayout />
    </MobileDataProvider>,
  );
  expect(screen.getByTestId("page-stack")).toBeVisible();
  expect(screen.queryByRole("tab", { name: "projects" })).not.toBeInTheDocument();
});

it("routes Finance account search to the real account list without a results list", async () => {
  h.path = "/finances/accounts";
  render(
    <WorkspaceMotion>
      <WorkspaceHeader />
    </WorkspaceMotion>,
  );
  fireEvent.change(screen.getByLabelText("Search accounts"), { target: { value: "Checking" } });
  expect(h.setParams).toHaveBeenCalledWith({ accountSearch: "Checking" });
  // Accounts filters its own list: no results list opens and the search route is not called.
  expect(screen.queryByRole("button", { name: "Include archive" })).toBeNull();
  expect(screen.queryByRole("heading")).toBeNull();
  await act(async () => new Promise((resolve) => setTimeout(resolve, 300)));
  expect(h.searchWorkspace).not.toHaveBeenCalled();
});

it("routes Mail search to the server-backed list without a results list", async () => {
  for (const path of ["/mail", "/mail/mailboxes"]) {
    h.path = path;
    h.params = {};
    const view = render(
      <WorkspaceMotion>
        <WorkspaceHeader />
      </WorkspaceMotion>,
    );
    fireEvent.change(screen.getByLabelText("Search mail"), { target: { value: "Maya" } });
    expect(h.setParams).toHaveBeenLastCalledWith({ mailSearch: "Maya" });
    expect(screen.queryByRole("button", { name: "Include archive" })).toBeNull();
    expect(screen.queryByRole("heading")).toBeNull();
    await act(async () => new Promise((resolve) => setTimeout(resolve, 300)));
    expect(h.searchWorkspace).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Dismiss navigation menu or search" })).toBeNull();
    // The field shows the route's search, so it survives a remount of the header.
    h.params = { mailSearch: "Maya" };
    view.rerender(
      <WorkspaceMotion>
        <WorkspaceHeader />
      </WorkspaceMotion>,
    );
    expect(screen.getByLabelText("Search mail")).toHaveValue("Maya");
    view.unmount();
  }
});

it("supports accessibility activation, pointer preview and focus dismissal without replacing search", async () => {
  render(<Shell />);
  await act(async () => {});
  const search = screen.getByLabelText("Search today");
  act(() => h.accessibilityTap?.());
  const mail = screen.getByRole("button", { name: "Open mail" });
  fireEvent.mouseEnter(mail);
  expect(mail.querySelector('[data-icon="mail"]')).toHaveAttribute("data-filled", "true");
  fireEvent.mouseLeave(mail);
  expect(mail.querySelector('[data-icon="mail"]')).toHaveAttribute("data-filled", "false");
  fireEvent.focus(search);
  expect(screen.queryByRole("button", { name: "Open mail" })).toBeNull();
  expect(screen.getByLabelText("Search today")).toBe(search);
  expect(h.responders[0].onPanResponderTerminationRequest?.(event(), gesture())).toBe(false);
});
it("keeps workspace glyph contrast aligned with dark and light Today hero chrome", () => {
  const view = render(<WorkspaceHeader chromeDark />);
  expect(
    screen.getByRole("button", { name: "Switch workspace, today" }).querySelector("[data-icon]"),
  ).toHaveAttribute("data-color", "#f8f8fc");
  view.rerender(<WorkspaceHeader chromeDark={false} />);
  expect(
    screen.getByRole("button", { name: "Switch workspace, today" }).querySelector("[data-icon]"),
  ).toHaveAttribute("data-color", "#202024");
});
it("cancels a pending workspace hold when the header unmounts", async () => {
  h.platform.OS = "ios";
  const view = render(<Shell />);
  await act(async () => {});
  vi.useFakeTimers();
  act(() => h.responders[0].onPanResponderGrant?.(event(), gesture()));
  view.unmount();
  await act(async () => vi.advanceTimersByTimeAsync(250));
  expect(h.selection).not.toHaveBeenCalled();
  expect(h.navigate).not.toHaveBeenCalled();
});
it("does not select a workspace in Settings until a gesture resolves to a concrete menu row", async () => {
  h.path = "/settings";
  h.platform.OS = "ios";
  render(<Shell />);
  await act(async () => {});
  fireEvent.click(screen.getByRole("button", { name: "Switch workspace, settings" }));
  expect(screen.getByTestId("native-picker")).not.toHaveAttribute("data-selected");
  const menu = h.responders[1];
  act(() => menu.onPanResponderRelease?.(event(500, 500), gesture(0, 0)));
  expect(h.navigate).not.toHaveBeenCalled();
  expect(screen.queryByTestId("native-picker")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Switch workspace, settings" }));
  await act(async () => menu.onPanResponderRelease?.(event(20, 144), gesture(0, 0)));
  expect(h.navigate).toHaveBeenLastCalledWith("/tasks");
});

it("leaves Settings transitions to the native stack and resets workspace motion on return", async () => {
  h.path = "/tasks";
  const { rerender } = render(
    <WorkspaceMotion>
      <div>Workspace</div>
    </WorkspaceMotion>,
  );
  await act(async () => {});
  const count = h.animations.length;
  h.path = "/settings";
  rerender(
    <WorkspaceMotion>
      <div>Workspace</div>
    </WorkspaceMotion>,
  );
  h.path = "/settings/calendar/new";
  rerender(
    <WorkspaceMotion>
      <div>Workspace</div>
    </WorkspaceMotion>,
  );
  h.path = "/tasks";
  rerender(
    <WorkspaceMotion>
      <div>Workspace</div>
    </WorkspaceMotion>,
  );
  expect(h.animations).toHaveLength(count);
  h.path = "/tasks/projects";
  rerender(
    <WorkspaceMotion>
      <div>Workspace</div>
    </WorkspaceMotion>,
  );
  expect(h.animations).toHaveLength(count + 1);
});
