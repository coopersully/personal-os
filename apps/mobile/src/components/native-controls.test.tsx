// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  Fragment,
  type PropsWithChildren,
  type ReactElement,
  type ReactNode,
  useState,
} from "react";
import { afterAll, afterEach, beforeEach, expect, it, vi } from "vitest";
import { DateField } from "../features/tasks/date-field.ios";
import { OptionsMenu } from "../features/tasks/options-menu.ios";
import { buildViewOptions } from "../features/tasks/view-options";
import { workspaces } from "../theme";
import { AppToaster } from "./app-toaster";
import { EditorClose } from "./editor-close.ios";
import { Icon } from "./icons";
import { RowActions } from "./row-actions.ios";
import { WorkspacePicker } from "./workspace-picker.ios";
import { WorkspaceTabs } from "./workspace-tabs.ios";

vi.mock("react", async () => {
  const { createRequire } = await import("node:module");
  return createRequire(`${process.cwd()}/package.json`)("react");
});
const h = vi.hoisted(() => {
  // Metro asset references are opaque handles. Keep application asset selection real.
  vi.stubGlobal("require", (path: string) => path);
  return {
    dark: false,
    path: "/tasks",
    timezone: "America/New_York" as string | undefined,
    reduced: false,
    assetsReady: true,
    sources: [] as unknown[][],
    toaster: {} as Record<string, unknown>,
    tabs: {} as Record<string, unknown>,
    change: vi.fn(),
  };
});
vi.mock("react-native", async () => ({
  ...(await import("../../test/native")),
  Platform: { OS: "ios" },
  useColorScheme: () => (h.dark ? "dark" : "light"),
  Image: ({ source, style }: { source: string; style: { tintColor: string } }) => (
    <img alt="App icon" src={source} data-tint={style.tintColor} />
  ),
}));
vi.mock("../features/auth/context", () => ({
  useAuth: () => ({ state: { user: { planningTimezone: h.timezone } } }),
}));
vi.mock("expo-router", () => ({ usePathname: () => h.path }));
vi.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 40, bottom: 20 }),
}));
vi.mock("sonner-native", () => ({
  Toaster: (props: Record<string, unknown>) => {
    h.toaster = props;
    return (
      <div data-testid="toaster">
        {Object.entries(props.icons as Record<string, ReactNode>).map(([name, icon]) => (
          <Fragment key={name}>{icon}</Fragment>
        ))}
      </div>
    );
  },
}));
vi.mock("expo-asset", () => ({
  useAssets: (sources: unknown[]) => {
    h.sources.push(sources);
    return [h.assetsReady ? sources.map((source) => ({ localUri: `asset:${source}` })) : undefined];
  },
}));
vi.mock("react-native-reanimated", () => ({ useReducedMotion: () => h.reduced }));
vi.mock("@expo/ui/community/datetime-picker", () => ({
  default: ({
    value,
    mode,
    timeZoneName,
    accentColor,
    onChange,
  }: {
    value: Date;
    mode: string;
    timeZoneName: string;
    accentColor: string;
    onChange: (event: object, date?: Date) => void;
  }) => (
    <div>
      <input
        aria-label={`Native ${mode}`}
        data-timezone={timeZoneName}
        data-accent={accentColor}
        value={value.toISOString()}
        onChange={(event) => onChange({}, new Date(event.target.value))}
      />
      <button type="button" onClick={() => onChange({})}>
        Dismiss {mode} picker
      </button>
    </div>
  ),
}));
type Modifier = { kind: string; value: unknown };
vi.mock("@expo/ui/swift-ui/modifiers", () => {
  const modifier =
    (kind: string) =>
    (value?: unknown, ...rest: unknown[]) => ({ kind, value, rest });
  return Object.fromEntries([
    ..."accessibilityLabel disabled font foregroundStyle frame pickerStyle tag accessibilityHidden animation glassEffect offset padding resizable"
      .split(" ")
      .map((name) => [name, modifier(name)]),
    ["Animation", { snappy: modifier("snappy") }],
  ]);
});
vi.mock("@expo/ui/swift-ui", async () => {
  const { Children } = await import("react");
  const Box = ({ children }: PropsWithChildren) => <div>{children}</div>;
  const Text = ({ children, modifiers }: PropsWithChildren<{ modifiers?: Modifier[] }>) => (
    <span data-modifiers={JSON.stringify(modifiers)}>{children}</span>
  );
  return {
    Host: Box,
    HStack: Box,
    VStack: Box,
    ZStack: Box,
    GlassEffectContainer: Box,
    Section: Box,
    Text,
    Rectangle: ({ modifiers }: { modifiers: Modifier[] }) => (
      <div data-testid="glass-shape" data-modifiers={JSON.stringify(modifiers)} />
    ),
    Image: ({ uiImage }: { uiImage?: string }) => <img alt="Menu icon" src={uiImage} />,
    Menu: ({ children, modifiers }: PropsWithChildren<{ modifiers?: Modifier[] }>) => (
      <section
        aria-label={String(
          modifiers?.find((m) => m.kind === "accessibilityLabel")?.value ?? "Menu",
        )}
      >
        {children}
      </section>
    ),
    Button: ({
      children,
      label,
      onPress,
      modifiers,
      role,
    }: PropsWithChildren<{
      label?: string;
      onPress?: () => void;
      modifiers?: Modifier[];
      role?: string;
    }>) => (
      <button
        type="button"
        disabled={!!modifiers?.find((m) => m.kind === "disabled")?.value}
        data-native-role={role}
        onClick={onPress}
      >
        {label ?? children}
      </button>
    ),
    Picker: ({
      children,
      label,
      selection,
      onSelectionChange,
    }: PropsWithChildren<{
      label: string;
      selection: string;
      onSelectionChange: (value: string) => void;
    }>) => (
      <select
        aria-label={label}
        value={selection}
        onChange={(event) => onSelectionChange(event.target.value)}
      >
        {Children.toArray(children).map((child) => {
          const element = child as ReactElement<{ modifiers: Modifier[]; children: string }>;
          const value = String(element.props.modifiers.find((m) => m.kind === "tag")?.value);
          return (
            <option key={value} value={value}>
              {element.props.children}
            </option>
          );
        })}
      </select>
    ),
  };
});
vi.mock("expo-router/native-tabs", () => {
  const Label = ({ children }: PropsWithChildren) => <span>{children}</span>;
  const Image = ({ src }: { src: { default: string; selected: string } }) => (
    <span data-testid="native-tab-icon" data-default={src.default} data-selected={src.selected} />
  );
  const Trigger = Object.assign(
    ({ children, accessibilityLabel }: PropsWithChildren<{ accessibilityLabel: string }>) => (
      <div role="tab" tabIndex={0} aria-label={accessibilityLabel}>
        {children}
      </div>
    ),
    { Label, Icon: Image },
  );
  return {
    NativeTabs: Object.assign(
      (props: PropsWithChildren<Record<string, unknown>>) => {
        h.tabs = props;
        return <div role="tablist">{props.children}</div>;
      },
      { Trigger },
    ),
  };
});
beforeEach(() => {
  vi.clearAllMocks();
  h.dark = false;
  h.path = "/tasks";
  h.timezone = "America/New_York";
  h.reduced = false;
  h.assetsReady = true;
  h.sources = [];
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
afterAll(() => vi.unstubAllGlobals());
function DateForm({
  initial = null,
  dateOnly = false,
  due = true,
}: {
  initial?: string | null;
  dateOnly?: boolean;
  due?: boolean;
}) {
  const [value, setValue] = useState(initial);
  return (
    <DateField
      label="Due date"
      value={value}
      dateOnly={dateOnly}
      due={due}
      onChange={(next) => {
        h.change(next);
        setValue(next);
      }}
    />
  );
}
it("opens an unset native picker without dirtying the form and supports date/time changes", () => {
  render(<DateForm />);
  fireEvent.click(screen.getByRole("button", { name: "Set due date" }));
  expect(h.change).not.toHaveBeenCalled();
  expect(screen.getByLabelText("Native date")).toHaveAttribute("data-timezone", "America/New_York");
  fireEvent.click(screen.getByRole("button", { name: "Dismiss date picker" }));
  fireEvent.click(screen.getByRole("button", { name: "Dismiss time picker" }));
  expect(h.change).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("Native date"), {
    target: { value: "2026-11-08T14:00:00.000Z" },
  });
  fireEvent.change(screen.getByLabelText("Native time"), {
    target: { value: "2026-11-08T15:30:00.000Z" },
  });
  expect(h.change).toHaveBeenLastCalledWith("2026-11-08T15:30:00.000Z");
  fireEvent.click(screen.getByRole("button", { name: "Done" }));
  expect(screen.queryByLabelText("Native date")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /Due date, / }));
  fireEvent.click(screen.getByRole("button", { name: "Clear" }));
  expect(h.change).toHaveBeenLastCalledWith(null);
  fireEvent.click(screen.getByRole("button", { name: "Set due date" }));
  h.change.mockClear();
  fireEvent.click(screen.getByRole("button", { name: "Clear" }));
  expect(h.change).not.toHaveBeenCalled();
});
it("marks an overdue date in its collapsed and expanded controls and reschedules relative to today", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-06T17:00:00Z"));
  render(<DateForm initial="2026-11-01T12:00:00Z" />);
  fireEvent.click(screen.getByRole("button", { name: /Due date, overdue/ }));
  expect(screen.getByText("Due date · Overdue")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Tomorrow, 9 AM" }));
  expect(h.change).toHaveBeenLastCalledWith("2026-11-07T14:00:00.000Z");
  fireEvent.click(screen.getByRole("button", { name: /Due date, / }));
  fireEvent.click(screen.getByRole("button", { name: "In 1 week, 9 AM" }));
  expect(h.change).toHaveBeenLastCalledWith("2026-11-13T14:00:00.000Z");
  fireEvent.click(screen.getByRole("button", { name: /Due date, / }));
  fireEvent.click(screen.getByRole("button", { name: "In 1 hour" }));
  expect(h.change).toHaveBeenLastCalledWith("2026-11-06T18:00:00.000Z");
  act(() => vi.advanceTimersByTime(3700000));
  expect(screen.getByRole("button", { name: /Due date, overdue/ })).toBeVisible();
});
it("keeps date-only values in the user timezone with no time control", () => {
  render(<DateForm initial="2026-11-06" dateOnly due={false} />);
  fireEvent.click(screen.getByRole("button", { name: "Due date, 2026-11-06" }));
  expect(screen.queryByLabelText("Native time")).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Native date"), {
    target: { value: "2026-11-07T02:00:00Z" },
  });
  expect(h.change).toHaveBeenLastCalledWith("2026-11-06");
  expect(screen.queryByRole("button", { name: "In 1 hour" })).not.toBeInTheDocument();
});
it("does not invent a timezone before the account is available", () => {
  h.timezone = undefined;
  const { container } = render(<DateForm />);
  expect(container).toBeEmptyDOMElement();
});
it("provides native view pickers and keeps detailed filters separate", () => {
  const change = vi.fn(),
    advanced = vi.fn(),
    reset = vi.fn();
  render(
    <OptionsMenu
      choices={buildViewOptions({ sort: "auto" }, { view: "all" })}
      onChange={change}
      onAdvanced={advanced}
      onReset={reset}
    />,
  );
  fireEvent.change(screen.getByLabelText("Sort by"), { target: { value: "priority" } });
  expect(change).toHaveBeenCalledWith("sort", "priority");
  fireEvent.change(screen.getByLabelText("Group by"), { target: { value: "project" } });
  expect(change).toHaveBeenCalledWith("group", "project");
  fireEvent.click(screen.getByRole("button", { name: "Filters…" }));
  expect(advanced).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole("button", { name: "Reset view" }));
  expect(reset).toHaveBeenCalledOnce();
  expect(screen.queryByLabelText("Priority")).not.toBeInTheDocument();
});
it("puts destructive native actions last with matching colored icon assets", () => {
  const trash = vi.fn(),
    pin = vi.fn();
  const { rerender } = render(
    <RowActions
      label="Task actions"
      actions={[
        { id: "trash", label: "Move to Trash", icon: "trash", destructive: true, onPress: trash },
        { id: "pin", label: "Pin", icon: "pin", onPress: pin },
      ]}
    />,
  );
  expect(screen.getAllByRole("button").map((button) => button.textContent)).toEqual([
    "Pin",
    "Move to Trash",
  ]);
  expect(screen.getByRole("button", { name: /Move to Trash/ })).toHaveAttribute(
    "data-native-role",
    "destructive",
  );
  expect(screen.getAllByRole("img")[1]).toHaveAttribute(
    "src",
    expect.stringContaining("TrashMenuDestructiveLight.png"),
  );
  fireEvent.click(screen.getByRole("button", { name: /Move to Trash/ }));
  expect(trash).toHaveBeenCalledOnce();
  h.dark = true;
  rerender(
    <RowActions
      label="Task actions"
      placement="header"
      actions={[
        {
          id: "trash",
          label: "Move to Trash",
          icon: "trash",
          destructive: true,
          disabled: true,
          onPress: trash,
        },
        { id: "pin", label: "Pin", icon: "pin", onPress: pin },
      ]}
    />,
  );
  expect(screen.getAllByRole("img")[1]).toHaveAttribute(
    "src",
    expect.stringContaining("TrashMenuDestructiveDark.png"),
  );
  expect(screen.getByRole("button", { name: /Move to Trash/ })).toBeDisabled();
  h.assetsReady = false;
  rerender(
    <RowActions
      label="Task actions"
      actions={[
        { id: "edit", label: "Edit", icon: "target", onPress: pin },
        { id: "pin", label: "Pin", icon: "pin", onPress: pin },
      ]}
    />,
  );
  expect(screen.queryAllByRole("img")).toHaveLength(0);
});
it("uses a direct action for one choice and omits an empty action menu", () => {
  const press = vi.fn();
  const { rerender } = render(
    <RowActions
      label="Actions"
      placement="header"
      actions={[{ id: "save", label: "Save", icon: "save", onPress: press }]}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(press).toHaveBeenCalledOnce();
  expect(screen.queryByRole("region", { name: "Actions" })).not.toBeInTheDocument();
  rerender(<RowActions label="Actions" actions={[]} />);
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
});
it("preserves native close accessibility and the disabled state", () => {
  const press = vi.fn();
  const { rerender } = render(<EditorClose label="Close" onPress={press} />);
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  expect(press).toHaveBeenCalledOnce();
  rerender(<EditorClose label="Cancel" disabled onPress={press} />);
  expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
});
it("uses filled native tab assets with workspace tint and the standard labels", () => {
  render(<WorkspaceTabs workspace="tasks" />);
  expect(screen.getAllByRole("tab").map((tab) => tab.getAttribute("aria-label"))).toEqual([
    "to-do",
    "projects",
    "lists",
    "browse",
  ]);
  expect(h.tabs.iconColor).toEqual(expect.objectContaining({ selected: h.tabs.tintColor }));
  for (const icon of screen.getAllByTestId("native-tab-icon"))
    expect(icon.getAttribute("data-selected")).toContain("Filled.png");
});
it("passes native glass modifiers for vertical selection and respects Reduce Motion", () => {
  const { rerender } = render(<WorkspacePicker selected="tasks" options={workspaces} />);
  expect(screen.getAllByTestId("glass-shape")).toHaveLength(2);
  expect(screen.getAllByTestId("glass-shape")[1].getAttribute("data-modifiers")).toContain(
    '"kind":"glassEffect"',
  );
  expect(screen.getAllByTestId("glass-shape")[1].getAttribute("data-modifiers")).toContain(
    '"kind":"animation"',
  );
  h.reduced = true;
  h.dark = true;
  rerender(<WorkspacePicker selected="mail" options={workspaces} />);
  expect(screen.getAllByTestId("glass-shape")[1].getAttribute("data-modifiers")).not.toContain(
    '"kind":"animation"',
  );
  h.assetsReady = false;
  rerender(<WorkspacePicker selected={null} options={workspaces} />);
  expect(screen.getAllByTestId("glass-shape")).toHaveLength(1);
});
it("selects filled icons when available and keeps unsupported glyphs as outlines", () => {
  const { rerender } = render(<Icon name="tasks" filled color="purple" />);
  expect(screen.getByRole("img")).toHaveAttribute(
    "src",
    expect.stringContaining("ListChecksFilled.png"),
  );
  rerender(<Icon name="trash" filled color="red" size={24} />);
  expect(screen.getByRole("img")).toHaveAttribute("src", expect.stringContaining("Trash.png"));
  expect(screen.getByRole("img")).toHaveAttribute("data-tint", "red");
});
it("hosts stacked high-contrast feedback only on the active screen layer", () => {
  const { rerender } = render(<AppToaster />);
  expect(h.toaster).toMatchObject({
    enableStacking: true,
    visibleToasts: 3,
    fullWindowOverlay: true,
    closeButton: true,
    theme: "dark",
  });
  h.path = "/task-editor";
  rerender(<AppToaster />);
  expect(screen.queryByTestId("toaster")).not.toBeInTheDocument();
  h.dark = true;
  rerender(<AppToaster editor />);
  expect(h.toaster).toMatchObject({ fullWindowOverlay: false, theme: "light" });
  expect(screen.getByTestId("toaster")).toBeVisible();
  h.path = "/finance-transaction-edit";
  rerender(<AppToaster />);
  expect(screen.queryByTestId("toaster")).not.toBeInTheDocument();
  rerender(<AppToaster editor />);
  expect(screen.getByTestId("toaster")).toBeVisible();
  expect(h.toaster).toMatchObject({ fullWindowOverlay: true });
  h.path = "/tasks";
  rerender(<AppToaster editor />);
  expect(screen.queryByTestId("toaster")).not.toBeInTheDocument();
});
