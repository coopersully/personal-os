// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProfileTime } from "../../features/settings/profile-time.ios";
import { DateField } from "../../features/tasks/date-field.ios";
import { TagsField } from "../../features/tasks/tags-field";
import { EntityPicker } from "./entity-picker";
import { formBlock, formRow, insetRow } from "./form-row";
import { Action, Actions, Field, Group, Section, TitleField } from "./form-rows";
import { PlanningPicker } from "./planning-picker.ios";
import { SectionFootnote, SectionItem, SectionNote } from "./section-content";

vi.mock("react", async () => {
  const { createRequire } = await import("node:module");
  return createRequire(`${process.cwd()}/package.json`)("react");
});
type Styled = PropsWithChildren<{
  style?: unknown;
  testID?: string;
  accessibilityLabel?: string;
  accessibilityRole?: string;
  disabled?: boolean;
  selectable?: boolean;
  onPress?: () => void;
  value?: string;
  onChangeText?: (value: string) => void;
}>;
/** Style arrays and press-state functions collapse to the one object a row resolves to. */
const flat = (style: unknown): object =>
  typeof style === "function"
    ? flat(style({ pressed: false }))
    : Array.isArray(style)
      ? Object.assign({}, ...style.map(flat))
      : ((style as object | undefined) ?? {});
vi.mock("react-native", () => {
  const View = ({ children, style, testID }: Styled) => (
    <div data-testid={testID} data-style={JSON.stringify(flat(style))}>
      {children}
    </div>
  );
  return {
    Platform: { OS: "ios" },
    StyleSheet: { create: <T,>(value: T) => value, hairlineWidth: 1 },
    View,
    ScrollView: View,
    Modal: ({ children }: PropsWithChildren) => <div>{children}</div>,
    Switch: () => null,
    Text: ({ children, style, accessibilityRole, selectable }: Styled) =>
      accessibilityRole === "header" ? (
        <h2 data-style={JSON.stringify(flat(style))}>{children}</h2>
      ) : (
        <span data-style={JSON.stringify(flat(style))} data-selectable={String(!!selectable)}>
          {children}
        </span>
      ),
    TextInput: ({ accessibilityLabel, style, value, onChangeText }: Styled) => (
      <input
        aria-label={accessibilityLabel}
        data-style={JSON.stringify(flat(style))}
        value={value ?? ""}
        onChange={(event) => onChangeText?.(event.target.value)}
      />
    ),
    Pressable: ({
      children,
      style,
      accessibilityLabel,
      accessibilityRole,
      disabled,
      onPress,
    }: Styled) => (
      <button
        type="button"
        role={accessibilityRole === "radio" ? "radio" : undefined}
        aria-label={accessibilityLabel}
        disabled={disabled}
        onClick={onPress}
        data-style={JSON.stringify(flat(style))}
      >
        {children}
      </button>
    ),
  };
});
vi.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
vi.mock("../../theme", () => ({
  spacing: { xs: 4, sm: 8, md: 12, lg: 16, page: 20, xl: 24, xxl: 32 },
  radius: { control: 8, menu: 12, panel: 16 },
  touchTarget: 44,
  workspaceColor: () => "#7928ff",
  useTheme: () => ({
    dark: false,
    ink: "ink",
    secondary: "secondary",
    warning: "warning",
    destructive: "destructive",
    information: "information",
    surface: "surface",
    canvas: "canvas",
    line: "line",
  }),
}));
vi.mock("../icons", () => ({
  Icon: ({ name }: { name: string }) => <i data-icon={name} />,
}));
vi.mock("../sheet-header", () => ({
  SheetHeader: ({ title }: { title: string }) => <h2>{title}</h2>,
}));
vi.mock("../../features/auth/context", () => ({
  useAuth: () => ({ state: { user: { planningTimezone: "America/New_York" } } }),
  useOptionalAuth: () => null,
}));
vi.mock("@expo/ui/community/datetime-picker", () => ({
  default: ({ mode }: { mode: string }) => <div data-testid={`native-${mode}-picker`} />,
}));
afterEach(cleanup);
const styleOf = (element: Element | null) =>
  JSON.parse(element?.getAttribute("data-style") ?? "{}") as Record<string, unknown>;
const row = { minHeight: 56, paddingHorizontal: 16, paddingVertical: 12, gap: 12 };
const pickerBody = { paddingHorizontal: 16, paddingBottom: 12, gap: 8 };
const trailingActions = { flexDirection: "row", justifyContent: "flex-end", gap: 8 };

describe("shared row geometry", () => {
  it("defines one row, its inset form for padded surfaces, and one stacked block", () => {
    expect(formRow).toEqual({ ...row, flexDirection: "row", alignItems: "center" });
    expect(insetRow).toEqual({ ...formRow, paddingHorizontal: 0 });
    expect(formBlock).toEqual({ paddingHorizontal: 16, paddingVertical: 12, gap: 8 });
  });
});

describe("SectionNote, SectionItem and SectionFootnote", () => {
  it("aligns a note with the rows around it in the secondary color by default", () => {
    render(<SectionNote>Applies to new tasks only.</SectionNote>);
    const note = screen.getByText("Applies to new tasks only.");
    expect(styleOf(note)).toEqual({
      color: "secondary",
      fontSize: 15,
      lineHeight: 21,
      paddingHorizontal: 16,
      paddingVertical: 12,
    });
    expect(note).toHaveAttribute("data-selectable", "false");
  });
  it.each([
    [{ ink: true }, "ink"],
    [{ warning: true }, "warning"],
    [{ ink: true, warning: true }, "warning"],
  ])("colors a note for %o without changing its geometry", (props, color) => {
    render(<SectionNote {...props}>Needs attention</SectionNote>);
    expect(styleOf(screen.getByText("Needs attention"))).toMatchObject({
      color,
      paddingHorizontal: 16,
      paddingVertical: 12,
    });
  });
  it("lets a value worth copying be selected", () => {
    render(<SectionNote selectable>nohmi number: +1 555 0100</SectionNote>);
    expect(screen.getByText("nohmi number: +1 555 0100")).toHaveAttribute(
      "data-selectable",
      "true",
    );
  });
  it("gives a record row the group's side padding and nothing else", () => {
    render(
      <SectionItem>
        <span>Swim twice a week</span>
      </SectionItem>,
    );
    const item = screen.getByTestId("section-item");
    expect(styleOf(item)).toEqual({ paddingHorizontal: 16 });
    expect(item).toHaveTextContent("Swim twice a week");
  });
  it("sets a footnote under the group it explains, aligned with the group's text", () => {
    render(<SectionFootnote>Your password stays only in this form.</SectionFootnote>);
    expect(styleOf(screen.getByText("Your password stays only in this form."))).toMatchObject({
      color: "secondary",
      fontSize: 13,
      marginHorizontal: 16,
      marginTop: -12,
      marginBottom: 24,
    });
  });
});

describe("Group, Section, Actions and TitleField", () => {
  it("puts every child of a section in one group with seams only between rows", () => {
    render(
      <Section title="Records">
        <span>History</span>
        <span>Export</span>
      </Section>,
    );
    const group = screen.getByTestId("form-group");
    expect(screen.getByRole("heading", { name: "Records" })).toBeVisible();
    expect(group).toHaveTextContent("HistoryExport");
    expect(styleOf(group)).toMatchObject({ backgroundColor: "surface", borderRadius: 16 });
    expect(group.querySelectorAll('[data-style*="marginLeft"]')).toHaveLength(1);
  });
  it("renders an untitled group without a header", () => {
    render(
      <Group>
        <span>Only row</span>
      </Group>,
    );
    expect(screen.queryByRole("heading")).toBeNull();
    expect(
      screen.getByTestId("form-group").querySelectorAll('[data-style*="marginLeft"]'),
    ).toHaveLength(0);
  });
  it.each([
    [true, 4],
    [false, -12],
  ])("right-aligns inline editor commands on the row edge (inset %s)", (inset, margin) => {
    const save = vi.fn();
    const view = render(
      <Actions inset={inset}>
        <Action label="Cancel" onPress={vi.fn()} />
        <Action label="Save" accessibilityLabel="Save note" disabled={false} onPress={save} />
      </Actions>,
    );
    expect(styleOf(view.container.firstElementChild)).toMatchObject({
      ...trailingActions,
      marginHorizontal: margin,
    });
    const buttons = screen.getAllByRole("button");
    expect(buttons.map((button) => button.textContent)).toEqual(["Cancel", "Save"]);
    expect(styleOf(buttons[1] ?? null)).toMatchObject({ minHeight: 44, minWidth: 44 });
    fireEvent.click(screen.getByRole("button", { name: "Save note" }));
    expect(save).toHaveBeenCalledOnce();
  });
  it("dims a disabled command and marks a destructive one", () => {
    render(
      <Actions>
        <Action label="Remove" destructive onPress={vi.fn()} />
        <Action label="Add" disabled onPress={vi.fn()} />
      </Actions>,
    );
    expect(styleOf(screen.getByText("Remove"))).toMatchObject({ color: "destructive" });
    expect(screen.getByRole("button", { name: "Add" })).toBeDisabled();
    expect(styleOf(screen.getByRole("button", { name: "Add" }))).toMatchObject({ opacity: 0.4 });
  });
  it("gives a record title's leading identity a fixed slot beside the title", () => {
    const view = render(<TitleField label="Title" value="Home" leading={<i data-icon="home" />} />);
    expect(styleOf(view.container.firstElementChild)).toMatchObject({
      padding: 16,
      flexDirection: "row",
      alignItems: "flex-start",
    });
    expect(styleOf(screen.getByTestId("title-field-leading"))).toEqual({
      width: 44,
      marginRight: 16,
      alignItems: "center",
    });
    expect(styleOf(screen.getByLabelText("Title"))).toMatchObject({ flex: 1, fontSize: 24 });
    view.rerender(<TitleField label="Title" value="Home" />);
    expect(screen.queryByTestId("title-field-leading")).toBeNull();
  });
  it("uses the shared block padding for an expanded field", () => {
    const view = render(<Field compact={false} label="Description" value="" multiline />);
    expect(styleOf(view.container.firstElementChild)).toEqual(formBlock);
  });
});

describe("picker rows", () => {
  it("lists entity choices as shared rows in one group under the shared search field", () => {
    const change = vi.fn();
    const close = vi.fn();
    render(
      <EntityPicker
        title="Lists"
        icon="views"
        value="home"
        options={[
          { label: "Inbox", value: null },
          { label: "Home & errands", value: "home", icon: "home" },
        ]}
        onChange={change}
        onClose={close}
      />,
    );
    const group = screen.getByTestId("form-group");
    const options = screen.getAllByRole("radio");
    expect(options).toHaveLength(2);
    for (const option of options) {
      expect(group.contains(option)).toBe(true);
      expect(styleOf(option)).toMatchObject({ ...row, alignItems: "center", opacity: 1 });
    }
    expect(options[1]?.querySelector('[data-icon="save"]')).not.toBeNull();
    expect(options[0]?.querySelector('[data-icon="save"]')).toBeNull();
    expect(styleOf(screen.getByLabelText("Search lists"))).toMatchObject({
      minHeight: 44,
      paddingHorizontal: 16,
      borderRadius: 8,
    });
    fireEvent.click(screen.getByRole("radio", { name: "Inbox" }));
    expect(change).toHaveBeenCalledWith(null);
    expect(close).toHaveBeenCalledOnce();
  });
  it("shows an empty search result as a note inside the group", () => {
    render(
      <EntityPicker
        title="Projects"
        icon="views"
        value={null}
        options={[{ label: "Garden", value: "garden" }]}
        onChange={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText("Search projects"), { target: { value: "zzz" } });
    const note = screen.getByText("No matching projects.");
    expect(screen.getByTestId("form-group").contains(note)).toBe(true);
    expect(styleOf(note)).toMatchObject({ paddingHorizontal: 16, paddingVertical: 12 });
  });
  it.each([
    ["date", "Target date", "2026-11-09"],
    ["time", "Reminder time for the weekday morning ritual (optional)", "07:30"],
  ] as const)("gives the %s planning picker the shared row, body and commands", (mode, label, value) => {
    render(
      <PlanningPicker
        label={label}
        value={value}
        mode={mode}
        timeZone="America/New_York"
        optional
        onChange={vi.fn()}
      />,
    );
    const trigger = screen.getByRole("button", { name: new RegExp(`^${label.slice(0, 11)}`) });
    expect(styleOf(trigger)).toMatchObject({ ...row, opacity: 1 });
    fireEvent.click(trigger);
    const body = screen.getByTestId(`native-${mode}-picker`).parentElement;
    expect(styleOf(body)).toEqual(pickerBody);
    const done = screen.getByRole("button", { name: "Done" });
    expect(styleOf(done.parentElement)).toMatchObject({
      ...trailingActions,
      marginHorizontal: -12,
    });
    expect(
      Array.from(done.parentElement?.children ?? []).map((child) => child.textContent),
    ).toEqual([`Clear ${label.toLowerCase()}`, "Done"]);
  });
  it("gives the task date field the same row, body and Clear/Done line", () => {
    const change = vi.fn();
    const view = render(<DateField label="Due" value={null} onChange={change} due />);
    const unset = screen.getByRole("button", { name: "Set due" });
    expect(styleOf(unset)).toMatchObject({ ...row, opacity: 1 });
    fireEvent.click(unset);
    expect(styleOf(screen.getByText("Due").parentElement)).toMatchObject(row);
    const body = screen.getByTestId("native-date-picker").parentElement;
    expect(styleOf(body)).toEqual(pickerBody);
    const done = screen.getByRole("button", { name: "Done" });
    expect(styleOf(done.parentElement)).toMatchObject({
      ...trailingActions,
      marginHorizontal: -12,
    });
    expect(
      Array.from(done.parentElement?.children ?? []).map((child) => child.textContent),
    ).toEqual(["Clear", "Done"]);
    fireEvent.click(screen.getByRole("button", { name: "In 1 hour" }));
    expect(change).toHaveBeenCalledOnce();
    view.rerender(<DateField label="Due" value="2026-11-20T15:00:00.000Z" onChange={change} due />);
    expect(styleOf(screen.getByRole("button", { name: /^Due, / }))).toMatchObject(row);
  });
  it("gives the profile time row and its picker the same geometry", () => {
    render(<ProfileTime label="Day starts" value={420} onChange={vi.fn()} />);
    const trigger = screen.getByRole("button", { name: /^Day starts, / });
    expect(styleOf(trigger)).toMatchObject({ ...row, opacity: 1 });
    fireEvent.click(trigger);
    expect(styleOf(screen.getByTestId("native-time-picker").parentElement)).toEqual(pickerBody);
    expect(styleOf(screen.getByRole("button", { name: "Done" }).parentElement)).toMatchObject(
      trailingActions,
    );
  });
  it("pads the tags block like a row and ends its editor with Cancel then Add", () => {
    const view = render(<TagsField value={["errands"]} onChange={vi.fn()} />);
    expect(styleOf(view.container.firstElementChild)).toEqual(formBlock);
    fireEvent.click(screen.getByRole("button", { name: "Add tag" }));
    const add = screen.getByRole("button", { name: "Add" });
    expect(styleOf(add.parentElement)).toMatchObject(trailingActions);
    expect(Array.from(add.parentElement?.children ?? []).map((child) => child.textContent)).toEqual(
      ["Cancel", "Add"],
    );
  });
});
