// @vitest-environment jsdom
import { ApiClientError } from "@personal-os/api-client";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { PropsWithChildren, ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ContainerEditorScreen } from "./container-editor";
import { TaskEditorScreen } from "./task-editor";

vi.mock("react", async () => {
  const { createRequire } = await import("node:module");
  return createRequire(`${process.cwd()}/package.json`)("react");
});
const h = vi.hoisted(() => ({
  params: {} as Record<string, string>,
  record: undefined as unknown,
  isError: false,
  back: vi.fn(),
  replace: vi.fn(),
  refetch: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  loading: vi.fn(() => "action"),
  api: {
    createTaskList: vi.fn(),
    updateTaskList: vi.fn(),
    archiveTaskList: vi.fn(),
    createTaskProject: vi.fn(),
    updateTaskProject: vi.fn(),
    completeTaskProject: vi.fn(),
    cancelTaskProject: vi.fn(),
    archiveTaskProject: vi.fn(),
    createTask: vi.fn(),
    updateTask: vi.fn(),
    createReminder: vi.fn(),
    updateReminder: vi.fn(),
    previewTaskMove: vi.fn(),
    moveTask: vi.fn(),
    previewTaskProjectMove: vi.fn(),
    moveTaskProject: vi.fn(),
  },
}));
// Native primitives are rendered as accessible DOM controls; real form/state/action modules run.
vi.mock("react-native", () => {
  const Box = ({ children }: PropsWithChildren) => <div>{children}</div>;
  return {
    View: Box,
    Text: Box,
    ScrollView: Box,
    KeyboardAvoidingView: Box,
    Image: () => null,
    Pressable: ({
      children,
      onPress,
      disabled,
      accessibilityLabel,
      accessibilityRole,
      accessibilityState,
    }: PropsWithChildren<{
      onPress?: () => void;
      disabled?: boolean;
      accessibilityLabel?: string;
      accessibilityRole?: string;
      accessibilityState?: { checked?: boolean; expanded?: boolean };
    }>) =>
      accessibilityRole === "radio" ? (
        <label>
          <input
            type="radio"
            aria-label={accessibilityLabel}
            checked={accessibilityState?.checked}
            disabled={disabled}
            onChange={onPress}
          />
          {children}
        </label>
      ) : (
        <button
          type="button"
          aria-label={accessibilityLabel}
          aria-expanded={accessibilityState?.expanded}
          disabled={disabled}
          onClick={onPress}
        >
          {children}
        </button>
      ),
    TextInput: ({
      value,
      onChangeText,
      accessibilityLabel,
      placeholder,
      onBlur,
    }: {
      value?: string;
      onChangeText?: (s: string) => void;
      accessibilityLabel?: string;
      placeholder?: string;
      onBlur?: () => void;
    }) => (
      <input
        aria-label={accessibilityLabel}
        placeholder={placeholder}
        value={value ?? ""}
        onChange={(e) => onChangeText?.(e.target.value)}
        onBlur={onBlur}
      />
    ),
    Modal: ({ visible, children }: PropsWithChildren<{ visible: boolean }>) =>
      visible ? <div role="dialog">{children}</div> : null,
    FlatList: ({
      data,
      renderItem,
      ListEmptyComponent,
    }: {
      data: { value: string; label: string }[];
      renderItem: (v: { item: { value: string; label: string } }) => ReactNode;
      ListEmptyComponent: ReactNode;
    }) => (
      <div>
        {data.length
          ? data.map((item) => <div key={item.value}>{renderItem({ item })}</div>)
          : ListEmptyComponent}
      </div>
    ),
    ActivityIndicator: () => <div role="progressbar" />,
    StyleSheet: { create: (v: unknown) => v, hairlineWidth: 1 },
    Platform: { OS: "web" },
    useColorScheme: () => "light",
    Alert: { alert: vi.fn() },
  };
});
vi.mock("react-native-safe-area-context", async () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  SafeAreaView: ({ children }: PropsWithChildren) => <div>{children}</div>,
}));
vi.mock("expo-glass-effect", () => ({
  GlassView: ({ children }: PropsWithChildren) => <div>{children}</div>,
  isLiquidGlassAvailable: () => false,
}));
vi.mock("expo-router", () => ({
  router: { back: h.back, replace: h.replace },
  useLocalSearchParams: () => h.params,
  Stack: {
    Screen: ({
      options,
    }: {
      options: { headerLeft?: () => ReactNode; headerRight?: () => ReactNode };
    }) => (
      <div>
        {options.headerLeft?.()}
        {options.headerRight?.()}
      </div>
    ),
  },
}));
vi.mock("expo-crypto", () => ({ randomUUID: () => "00000000-0000-4000-8000-000000000099" }));
vi.mock("../../components/icons", () => ({
  Icon: ({ name }: { name: string }) => <span data-icon={name} />,
}));
vi.mock("../../components/app-toaster", () => ({
  AppToaster: () => <div data-testid="editor-toaster" />,
}));
vi.mock("../auth/context", () => ({
  useAuth: () => ({ state: { user: { planningTimezone: "America/New_York" } } }),
}));
vi.mock("sonner-native", () => ({
  toast: { success: h.success, error: h.error, loading: h.loading },
}));
vi.mock("../notifications/events", () => ({ refreshDueAlerts: vi.fn() }));
vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({
    data: h.record,
    isPending: !h.record && !h.isError,
    isError: h.isError,
    refetch: h.refetch,
  }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  QueryClient: vi.fn(),
  QueryCache: vi.fn(),
  QueryClientProvider: vi.fn(),
}));
const inbox = {
  id: "00000000-0000-4000-8000-000000000001",
  name: "Inbox",
  kind: "inbox",
  availability: "active",
  deletedAt: null,
  revision: 1,
};
const garden = {
  id: "00000000-0000-4000-8000-000000000002",
  name: "Garden",
  kind: "list",
  availability: "active",
  deletedAt: null,
  revision: 1,
};
vi.mock("./data", async (original) => ({
  ...(await original<typeof import("./data")>()),
  useTaskApi: () => h.api,
  useTaskResources: () => ({
    lists: { data: [inbox, garden] },
    projects: { data: [] },
    settings: { data: { preferences: { defaultCaptureListId: null } } },
  }),
}));
beforeEach(() => {
  vi.clearAllMocks();
  h.params = {};
  h.record = undefined;
  h.isError = false;
  vi.stubGlobal(
    "confirm",
    vi.fn(() => true),
  );
  for (const fn of Object.values(h.api))
    fn.mockReset().mockResolvedValue({ id: "saved", revision: 2 });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const save = () => screen.getByRole("button", { name: "Save changes" });
it.each([
  "list",
  "project",
])("creates a %s only after editing and preserves compact identity fields", async (kind) => {
  h.params = { kind };
  render(<ContainerEditorScreen />);
  expect(save()).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  expect(h.back).toHaveBeenCalledOnce();
  h.back.mockClear();
  fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Balcony garden" } });
  expect(screen.getByRole("button", { name: "Cancel" })).toBeVisible();
  expect(save()).toBeEnabled();
  fireEvent.click(save());
  await waitFor(() =>
    expect(kind === "list" ? h.api.createTaskList : h.api.createTaskProject).toHaveBeenCalledOnce(),
  );
  expect(kind === "list" ? h.api.createTaskList : h.api.createTaskProject).toHaveBeenCalledWith(
    expect.objectContaining({ name: "Balcony garden" }),
  );
  await waitFor(() => expect(h.back).toHaveBeenCalledOnce());
  expect(h.success).toHaveBeenCalledWith("Saved", expect.anything());
});
it.each([
  "list",
  "project",
])("keeps the %s draft paired with its original revision after a query refresh", async (kind) => {
  h.params = { kind, id: garden.id };
  h.record = {
    ...garden,
    name: "Original",
    description: "Old description",
    notes: "Old description",
    icon: "list",
    color: null,
    listId: inbox.id,
    lifecycle: "open",
  };
  const { rerender } = render(<ContainerEditorScreen />);
  h.record = {
    ...(h.record as object),
    revision: 2,
    description: "Remote update",
    notes: "Remote update",
  };
  rerender(<ContainerEditorScreen />);
  const update = kind === "list" ? h.api.updateTaskList : h.api.updateTaskProject;
  update.mockRejectedValue(
    new ApiClientError({ status: 409, code: "CONFLICT", message: "Changed elsewhere" }),
  );
  fireEvent.change(screen.getByLabelText("Title"), { target: { value: "My edit" } });
  fireEvent.click(save());
  await waitFor(() =>
    expect(update).toHaveBeenCalledWith(
      garden.id,
      expect.objectContaining({ expectedRevision: 1, name: "My edit" }),
    ),
  );
  expect(screen.getByLabelText("Title")).toHaveValue("My edit");
  expect(h.back).not.toHaveBeenCalled();
  await waitFor(() => expect(h.error).toHaveBeenCalled());
  expect(save()).toBeDisabled();
});
it.each([
  "task",
  "reminder",
])("creates a %s with edited title and priority", async (kind) => {
  h.params = { kind };
  render(<TaskEditorScreen />);
  expect(save()).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Plan meals" } });
  fireEvent.click(screen.getByRole("button", { name: "Priority, Medium" }));
  fireEvent.click(screen.getByRole("radio", { name: "High" }));
  fireEvent.click(save());
  const create = kind === "task" ? h.api.createTask : h.api.createReminder;
  await waitFor(() =>
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Plan meals", priority: "high" }),
    ),
  );
  await waitFor(() => expect(h.back).toHaveBeenCalledOnce());
});
it("keeps the toast host available while uncached editors load or fail", () => {
  h.params = { id: garden.id, kind: "list" };
  h.isError = true;
  render(<ContainerEditorScreen />);
  expect(screen.getByTestId("editor-toaster")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Retry loading" }));
  expect(h.refetch).toHaveBeenCalledOnce();
});
