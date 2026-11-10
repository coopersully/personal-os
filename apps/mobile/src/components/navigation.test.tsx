// @vitest-environment jsdom
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
  keyboard: vi.fn(),
  remove: vi.fn(),
  responders: [] as PanResponderCallbacks[],
  animations: [] as { duration: number; direction: number; useNativeDriver: boolean }[],
  changeReduced: undefined as undefined | ((value: boolean) => void),
}));
vi.mock("expo-router", () => ({
  router: { navigate: h.navigate, push: h.push, setParams: h.setParams },
  usePathname: () => h.path,
  useLocalSearchParams: () => ({}),
  useGlobalSearchParams: () => ({}),
  Stack: () => <div data-testid="page-stack" />,
}));
vi.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 44, bottom: 34 }),
}));
vi.mock("expo-haptics", () => ({ selectionAsync: h.selection }));
vi.mock("sonner-native", () => ({ toast: h }));
vi.mock("../features/auth/context", () => ({
  useAuth: () => ({
    state: { user: { id: "owner", displayName: "Test Person", email: "person@example.test" } },
    session: { logout: h.logout },
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
    },
  ) {
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
  h.platform.OS = "web";
  h.reduced = false;
  h.responders = [];
  h.animations = [];
  h.selection.mockReset().mockResolvedValue(undefined);
  h.logout.mockReset().mockResolvedValue(undefined);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
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
  const search = screen.getByLabelText("Search today sample data");
  fireEvent.click(screen.getByRole("button", { name: "Switch workspace, today" }));
  expect(screen.getByLabelText("Search today sample data")).toBe(search);
  fireEvent.click(screen.getByRole("button", { name: "Open tasks" }));
  expect(h.navigate).toHaveBeenCalledWith("/tasks");
  expect(screen.queryByRole("button", { name: "Open mail" })).not.toBeInTheDocument();
  for (const [label, path] of [
    ["settings", "/settings"],
    ["workspace settings", "/settings/workspaces"],
    ["agent settings", "/settings/agents"],
  ]) {
    fireEvent.click(screen.getByRole("button", { name: "Account menu" }));
    expect(screen.getByText("Test Person")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: label }));
    expect(h.navigate).toHaveBeenLastCalledWith(path);
  }
});
it("limits sample search by workspace and opens the matching detail", async () => {
  h.path = "/mail";
  const { rerender } = render(<Shell />);
  await act(async () => {});
  fireEvent.change(screen.getByLabelText("Search mail sample data"), { target: { value: "Maya" } });
  fireEvent.click(screen.getByRole("button", { name: "Maya needs a reply" }));
  expect(h.push).toHaveBeenCalledWith("/detail/reply");
  fireEvent.change(screen.getByLabelText("Search mail sample data"), {
    target: { value: "dentist" },
  });
  expect(screen.getByText("No sample matches. Try another search.")).toBeVisible();
  h.path = "/tasks";
  rerender(<Shell />);
  fireEvent.change(screen.getByLabelText("Search tasks"), { target: { value: "groceries" } });
  expect(screen.getByLabelText("Search tasks")).toHaveValue("groceries");
  expect(screen.queryByText(/sample results/)).not.toBeInTheDocument();
  h.path = "/settings";
  rerender(<Shell />);
  fireEvent.change(screen.getByLabelText("Search settings sample data"), {
    target: { value: "Maya" },
  });
  expect(screen.getByText("No sample matches. Try another search.")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Dismiss navigation menu or search" }));
  expect(screen.queryByText(/sample results/)).not.toBeInTheDocument();
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
  expect(screen.getByLabelText("Search today sample data")).toBeVisible();
  act(() => pan.onPanResponderMove?.(event(), gesture()));
  expect(screen.getByTestId("native-picker")).toHaveAttribute("data-selected", "tasks");
  await act(async () => pan.onPanResponderRelease?.(event(), gesture()));
  expect(h.navigate).toHaveBeenCalledWith("/tasks");
  expect(h.selection).toHaveBeenCalled();
  expect(screen.queryByTestId("native-picker")).not.toBeInTheDocument();
  expect(pan.onPanResponderTerminationRequest?.(event(), gesture())).toBe(false);
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
  h.path = "/mail";
  rerender(<Shell />);
  expect(screen.getByRole("button", { name: "Compose mail" })).toBeDisabled();
  h.path = "/calendar";
  rerender(<Shell />);
  expect(screen.getByRole("button", { name: "Add event" })).toBeDisabled();
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

it("routes Finance account search to the real account list without sample results", () => {
  h.path = "/finances/accounts";
  render(
    <WorkspaceMotion>
      <WorkspaceHeader />
    </WorkspaceMotion>,
  );
  fireEvent.change(screen.getByLabelText("Search accounts"), { target: { value: "Checking" } });
  expect(h.setParams).toHaveBeenCalledWith({ accountSearch: "Checking" });
  expect(screen.queryByText(/sample results/)).toBeNull();
});
