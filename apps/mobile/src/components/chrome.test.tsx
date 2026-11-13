// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { PropsWithChildren, ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorClose } from "./editor-close";
import { editorActionsOptions, editorDismissOptions, stackChromeOptions } from "./editor-header";
import { GlassButton, glassButtonSize } from "./glass-button";
import { SheetHeader } from "./sheet-header";

vi.mock("react", async () => {
  const { createRequire } = await import("node:module");
  return createRequire(`${process.cwd()}/package.json`)("react");
});
const h = vi.hoisted(() => ({
  platform: { OS: "ios" },
  dark: false,
  layouts: [] as ((event: { nativeEvent: { layout: { width: number } } }) => void)[],
  icons: [] as { name: string; color: string; size: number }[],
}));
type Styled = PropsWithChildren<{
  style?: object | ((state: { pressed: boolean }) => object);
  testID?: string;
  onLayout?: (typeof h.layouts)[number];
  accessibilityLabel?: string;
  accessibilityRole?: string;
  disabled?: boolean;
  onPress?: () => void;
  numberOfLines?: number;
  maxFontSizeMultiplier?: number;
  adjustsFontSizeToFit?: boolean;
}>;
vi.mock("react-native", () => ({
  Platform: h.platform,
  useColorScheme: () => (h.dark ? "dark" : "light"),
  View: ({ children, style, testID, onLayout }: Styled) => {
    if (onLayout) h.layouts.push(onLayout);
    return (
      <div data-testid={testID} data-style={JSON.stringify(style)}>
        {children}
      </div>
    );
  },
  Text: ({
    children,
    style,
    accessibilityRole,
    numberOfLines,
    maxFontSizeMultiplier,
    adjustsFontSizeToFit,
  }: Styled) =>
    accessibilityRole === "header" ? (
      <h2
        data-style={JSON.stringify(style)}
        data-lines={numberOfLines}
        data-max-scale={maxFontSizeMultiplier}
        data-fit={String(!!adjustsFontSizeToFit)}
      >
        {children}
      </h2>
    ) : (
      <span data-style={JSON.stringify(style)} data-lines={numberOfLines}>
        {children}
      </span>
    ),
  Pressable: ({ children, style, accessibilityLabel, disabled, onPress }: Styled) => (
    <button
      type="button"
      aria-label={accessibilityLabel}
      disabled={disabled}
      onClick={onPress}
      data-style={JSON.stringify(typeof style === "function" ? style({ pressed: false }) : style)}
    >
      {children}
    </button>
  ),
}));
vi.mock("../features/auth/context", () => ({ useOptionalAuth: () => null }));
vi.mock("./icons", () => ({
  icons: { edit: "Edit.png", trash: "Trash.png" },
  Icon: (props: { name: string; color: string; size: number }) => {
    h.icons.push(props);
    return <i data-icon={props.name} />;
  },
}));
vi.mock("./glass-surface", () => ({
  GlassSurface: ({
    children,
    style,
    colorScheme,
    isInteractive,
  }: PropsWithChildren<{ style: object; colorScheme: string; isInteractive: boolean }>) => (
    <div
      data-testid="glass"
      data-scheme={colorScheme}
      data-interactive={String(isInteractive)}
      data-style={JSON.stringify(style)}
    >
      {children}
    </div>
  ),
}));
vi.mock("./row-actions", () => ({
  RowActions: ({ label, actions }: { label: string; actions: { label: string }[] }) => (
    <fieldset aria-label={label}>{actions.map((action) => action.label).join(",")}</fieldset>
  ),
}));
afterEach(() => {
  cleanup();
  h.platform.OS = "ios";
  h.dark = false;
  h.layouts.length = 0;
  h.icons.length = 0;
});
const styleOf = (element: Element | null) =>
  JSON.parse(element?.getAttribute("data-style") ?? "{}") as Record<string, unknown>;
const longTitle = "Reminder time for the weekday morning ritual (optional)";

describe("GlassButton", () => {
  it.each([
    "Close",
    "Cancel",
    "Back",
    "Done",
  ])("gives the %s label a fixed-height capsule that grows with its text", (label) => {
    const press = vi.fn();
    render(<GlassButton label={label} onPress={press} />);
    const glass = screen.getByTestId("glass");
    expect(styleOf(glass)).toMatchObject({ height: 44, minWidth: 44, borderRadius: 22 });
    expect(styleOf(glass).width).toBeUndefined();
    expect(styleOf(glass)).toMatchObject({ flexShrink: 0 });
    expect(styleOf(screen.getByRole("button", { name: label }))).toMatchObject({
      paddingHorizontal: 16,
    });
    expect(screen.getByText(label)).toHaveAttribute("data-lines", "1");
    fireEvent.click(screen.getByRole("button", { name: label }));
    expect(press).toHaveBeenCalledOnce();
  });
  it.each([
    [false, "#202024"],
    [true, "#fafafa"],
  ])("keeps label text at primary ink on matching glass with dark mode %s", (dark, ink) => {
    h.dark = dark;
    render(<GlassButton label="Cancel" tint="#7928ff" onPress={vi.fn()} />);
    expect(styleOf(screen.getByText("Cancel"))).toMatchObject({ color: ink, fontSize: 17 });
    expect(screen.getByTestId("glass")).toHaveAttribute("data-scheme", dark ? "dark" : "light");
    expect(screen.getByTestId("glass")).toHaveAttribute("data-interactive", "true");
  });
  it.each([
    ["bar", 44, 22],
    ["floating", 56, 27],
  ] as const)("renders an icon-only %s control as a circle", (size, side, glyph) => {
    render(
      <GlassButton size={size} icon="edit" label="Edit list" tint="#7928ff" onPress={vi.fn()} />,
    );
    expect(glassButtonSize[size]).toBe(side);
    expect(styleOf(screen.getByTestId("glass"))).toMatchObject({
      width: side,
      height: side,
      borderRadius: side / 2,
    });
    expect(screen.queryByText("Edit list")).toBeNull();
    expect(styleOf(screen.getByRole("button", { name: "Edit list" }))).toMatchObject({
      paddingHorizontal: 0,
    });
    expect(h.icons.at(-1)).toEqual({ name: "edit", size: glyph, color: "#7928ff" });
  });
  it("shows a present but distinct disabled state and cannot resize through style", () => {
    const press = vi.fn();
    render(
      <GlassButton
        icon="edit"
        label="Save changes"
        tint="#7928ff"
        disabled
        onPress={press}
        style={{ marginBottom: 34, height: 10, borderRadius: 0 }}
      />,
    );
    const button = screen.getByRole("button", { name: "Save changes" });
    expect(button).toBeDisabled();
    expect(styleOf(button)).toMatchObject({ opacity: 0.5 });
    expect(h.icons.at(-1)?.color).toBe("#202024");
    expect(styleOf(screen.getByTestId("glass"))).toMatchObject({
      marginBottom: 34,
      height: 44,
      borderRadius: 22,
    });
    fireEvent.click(button);
    expect(press).not.toHaveBeenCalled();
  });
  it("uses the same button for the standard dismissal", () => {
    render(<EditorClose label="Back" onPress={vi.fn()} />);
    expect(styleOf(screen.getByTestId("glass"))).toMatchObject({ height: 44 });
    expect(screen.getByRole("button", { name: "Back" })).toBeEnabled();
  });
});

describe("SheetHeader", () => {
  const sides = () =>
    ["sheet-header-leading", "sheet-header-trailing"].map(
      (id) => styleOf(screen.getByTestId(id)).minWidth,
    );
  it.each([
    ["Filters", "Close"],
    [longTitle, "Cancel"],
    ["Home location", "Back"],
  ])("centers the title %s beside %s by reserving equal side slots", (title, label) => {
    const close = vi.fn();
    render(<SheetHeader title={title} label={label} onClose={close} />);
    const heading = screen.getByRole("heading", { name: title });
    expect(styleOf(heading)).toMatchObject({ textAlign: "center", flex: 1, minWidth: 0 });
    expect(heading).toHaveAttribute("data-lines", "1");
    // Large text: the title grows no more than the glass controls and shrinks to fit.
    expect(heading).toHaveAttribute("data-max-scale", "1.3");
    expect(heading).toHaveAttribute("data-fit", "true");
    expect(sides()).toEqual([0, 0]);
    // The leading control is the wider side; the empty trailing slot must match it.
    act(() => h.layouts[0]?.({ nativeEvent: { layout: { width: 83.4 } } }));
    act(() => h.layouts[1]?.({ nativeEvent: { layout: { width: 0 } } }));
    expect(sides()).toEqual([84, 84]);
    fireEvent.click(screen.getByRole("button", { name: label }));
    expect(close).toHaveBeenCalledOnce();
  });
  it("balances a wider trailing action and keeps the wider width when a label shrinks", () => {
    const done = vi.fn();
    const view = render(
      <SheetHeader
        title="Appearance"
        label="Cancel"
        onClose={vi.fn()}
        trailing={<GlassButton label="Done" onPress={done} />}
      />,
    );
    act(() => h.layouts[0]?.({ nativeEvent: { layout: { width: 70 } } }));
    act(() => h.layouts[1]?.({ nativeEvent: { layout: { width: 96 } } }));
    expect(sides()).toEqual([96, 96]);
    view.rerender(
      <SheetHeader
        title="Appearance"
        label="Close"
        onClose={vi.fn()}
        trailing={<GlassButton label="Done" onPress={done} />}
      />,
    );
    act(() => h.layouts[0]?.({ nativeEvent: { layout: { width: 60 } } }));
    expect(sides()).toEqual([96, 96]);
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(done).toHaveBeenCalledOnce();
  });
  it("keeps the title hidden until both sides are measured, so no frame is off-center", () => {
    render(<SheetHeader title="Filters" onClose={vi.fn()} />);
    const heading = screen.getByRole("heading", { name: "Filters" });
    expect(styleOf(heading)).toMatchObject({ opacity: 0 });
    act(() => h.layouts[0]?.({ nativeEvent: { layout: { width: 70 } } }));
    expect(styleOf(heading)).toMatchObject({ opacity: 0 });
    act(() => h.layouts[1]?.({ nativeEvent: { layout: { width: 0 } } }));
    expect(styleOf(heading)).toMatchObject({ opacity: 1 });
    expect(sides()).toEqual([70, 70]);
  });
  it.each([
    ["Filters", "Done"],
    [longTitle, "Done"],
  ])("puts a confirming-only %s sheet's %s on the trailing side, still centered", (title, label) => {
    const close = vi.fn();
    render(<SheetHeader title={title} label={label} dismiss="trailing" onClose={close} />);
    const done = screen.getByRole("button", { name: label });
    expect(screen.getByTestId("sheet-header-trailing").contains(done)).toBe(true);
    expect(screen.getByTestId("sheet-header-leading").contains(done)).toBe(false);
    expect(screen.getAllByRole("button")).toHaveLength(1);
    act(() => h.layouts[0]?.({ nativeEvent: { layout: { width: 0 } } }));
    act(() => h.layouts[1]?.({ nativeEvent: { layout: { width: 71.2 } } }));
    expect(sides()).toEqual([72, 72]);
    expect(styleOf(screen.getByRole("heading", { name: title }))).toMatchObject({
      textAlign: "center",
      opacity: 1,
    });
    fireEvent.click(done);
    expect(close).toHaveBeenCalledOnce();
  });
  it("defaults to Close, supports edge-to-edge sheets and disables dismissal while pending", () => {
    const close = vi.fn();
    const view = render(<SheetHeader title="Connect iCloud" onClose={close} disabled />);
    expect(screen.getByRole("button", { name: "Close" })).toBeDisabled();
    expect(styleOf(view.container.firstElementChild)).toMatchObject({
      paddingHorizontal: 20,
      minHeight: 60,
    });
    view.rerender(<SheetHeader title="Connect iCloud" onClose={close} inset={false} />);
    expect(styleOf(view.container.firstElementChild)).toMatchObject({ paddingHorizontal: 0 });
  });
});

describe("stack header options", () => {
  const theme = { destructive: "#ba2944" };
  const action = (id: string, destructive = false) => ({
    id,
    label: id,
    icon: (destructive ? "trash" : "edit") as "trash" | "edit",
    destructive,
    onPress: vi.fn(),
  });
  it.each([
    "Close",
    "Cancel",
    "Back",
  ])("declares %s as one native bar item on iOS with a glass fallback element", (label) => {
    const press = vi.fn();
    const options = editorDismissOptions({ label, onPress: press, disabled: label === "Cancel" });
    expect(options.unstable_headerLeftItems?.()).toEqual([
      { type: "button", label, onPress: press, disabled: label === "Cancel" },
    ]);
    render(options.headerLeft() as ReactElement);
    const button = screen.getByRole("button", { name: label });
    expect((button as HTMLButtonElement).disabled).toBe(label === "Cancel");
    if (label !== "Cancel") fireEvent.click(button);
    expect(press).toHaveBeenCalledTimes(label === "Cancel" ? 0 : 1);
  });
  it("uses only the fallback control where native bar items are unavailable", () => {
    h.platform.OS = "web";
    const options = editorDismissOptions({ label: "Close", onPress: vi.fn() });
    expect("unstable_headerLeftItems" in options).toBe(false);
    expect("unstable_headerRightItems" in editorActionsOptions("Actions", [], theme)).toBe(false);
    expect(
      "unstable_headerRightItems" in editorActionsOptions("Actions", [action("a")], theme),
    ).toBe(false);
  });
  it("renders no trailing control, and clears native items, when there are no actions", () => {
    expect(editorActionsOptions("Record actions", [], theme)).toEqual({
      headerRight: undefined,
      unstable_headerRightItems: undefined,
    });
  });
  it("gives one action a native icon button", () => {
    const edit = action("Edit transaction");
    const options = editorActionsOptions("Transaction actions", [edit], theme);
    expect(options.unstable_headerRightItems?.()).toEqual([
      {
        type: "button",
        label: "Edit transaction",
        accessibilityLabel: "Edit transaction",
        icon: { type: "image", source: "Edit.png" },
        disabled: undefined,
        onPress: edit.onPress,
      },
    ]);
    // An ordinary action takes the bar's own tint.
    expect(options.unstable_headerRightItems?.()[0]).not.toHaveProperty("tintColor");
    render(options.headerRight?.() as ReactElement);
    expect(screen.getByRole("group", { name: "Edit transaction" })).toHaveTextContent(
      "Edit transaction",
    );
  });
  it.each([
    [false, "light", "dark"],
    [true, "dark", "light"],
  ] as const)("styles every stack's bar from the app theme (dark %s)", (dark, bar, status) => {
    expect(stackChromeOptions({ dark, ink: "ink", canvas: "canvas" })).toEqual({
      headerTintColor: "ink",
      statusBarStyle: status,
      headerUserInterfaceStyle: bar,
      headerStyle: { backgroundColor: "canvas" },
      contentStyle: { backgroundColor: "canvas" },
      headerShadowVisible: false,
      headerBackButtonDisplayMode: "minimal",
    });
  });
  it("keeps a single destructive action red in the screen's theme", () => {
    const archive = action("Archive", true);
    const light = editorActionsOptions("Record actions", [archive], theme);
    expect(light.unstable_headerRightItems?.()[0]).toMatchObject({
      label: "Archive",
      icon: { type: "image", source: "Trash.png" },
      tintColor: "#ba2944",
    });
    const dark = editorActionsOptions("Record actions", [archive], { destructive: "#ff8190" });
    expect(dark.unstable_headerRightItems?.()[0]).toMatchObject({ tintColor: "#ff8190" });
  });
  it("gives several actions the shared menu and no competing native item", () => {
    const options = editorActionsOptions(
      "Record actions",
      [action("Complete"), action("Move to Trash", true)],
      theme,
    );
    expect(options.unstable_headerRightItems).toBeUndefined();
    render(options.headerRight?.() as ReactElement);
    expect(screen.getByRole("group", { name: "Record actions" })).toHaveTextContent(
      "Complete,Move to Trash",
    );
  });
});
