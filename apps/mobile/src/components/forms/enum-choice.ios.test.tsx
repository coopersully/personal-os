// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Children, type PropsWithChildren, type ReactElement } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { EnumChoice } from "./enum-choice.ios";

vi.mock("react", async () => {
  const { createRequire } = await import("node:module");
  return createRequire(`${process.cwd()}/package.json`)("react");
});
vi.mock("react-native", () => import("../../../test/native"));
vi.mock("../../theme", () => ({
  spacing: { md: 12, lg: 16, xl: 24 },
  radius: { panel: 16 },
  workspaceColor: () => "purple",
  useTheme: () => ({ ink: "black", secondary: "gray", dark: false }),
}));
vi.mock("../icons", () => ({ icons: { save: 1, views: 2, settings: 3 }, Icon: () => null }));
vi.mock("../enum-menu-icons", () => ({ enumMenuIcons: { views: { light: 2, dark: 4 } } }));
vi.mock("expo-asset", () => ({
  useAssets: (ids: number[]) => [ids.map((id) => ({ localUri: `file://${id}.png` }))],
}));
vi.mock("@expo/ui/swift-ui/modifiers", () => ({
  accessibilityLabel: (value: string) => ({ name: "label", value }),
  disabled: (value: boolean) => ({ name: "disabled", value }),
  frame: () => ({}),
  resizable: () => ({}),
  pickerStyle: () => ({}),
  tag: (value: string) => ({ name: "tag", value }),
}));
vi.mock("@expo/ui/swift-ui", () => {
  type Modifier = { name?: string; value?: string | boolean };
  const Container = ({ children }: PropsWithChildren) => <div>{children}</div>;
  return {
    Host: Container,
    HStack: Container,
    RNHostView: Container,
    Text: Container,
    Spacer: () => <span data-testid="native-spacer" />,
    Image: ({ uiImage }: { uiImage: string }) => (
      <span data-testid="native-image" data-uri={uiImage} />
    ),
    Menu: ({
      label,
      modifiers,
      children,
    }: PropsWithChildren<{ label: React.ReactNode; modifiers: Modifier[] }>) => (
      <section aria-label={String(modifiers.find((m) => m.name === "label")?.value)}>
        {label}
        {children}
      </section>
    ),
    Picker: ({
      label,
      selection,
      modifiers,
      onSelectionChange,
      children,
    }: PropsWithChildren<{
      label: string;
      selection: string;
      modifiers: Modifier[];
      onSelectionChange: (value: string) => void;
    }>) => (
      <div>
        <select
          aria-label={label}
          value={selection}
          disabled={!!modifiers.find((m) => m.name === "disabled")?.value}
          onChange={(event) => onSelectionChange(event.target.value)}
        >
          {Children.toArray(children).map((child) => {
            const value = (child as ReactElement<{ modifiers: Modifier[] }>).props.modifiers.find(
              (m) => m.name === "tag",
            )?.value;
            return (
              <option key={String(value)} value={String(value)}>
                {String(value)}
              </option>
            );
          })}
        </select>
        {children}
      </div>
    ),
  };
});
afterEach(cleanup);
const options = [
  { label: "Compact", value: "compact", icon: "views" as const },
  { label: "Comfortable", value: "comfortable" },
];
it("uses a native picker menu with accessible current value and bounded semantic artwork", () => {
  const change = vi.fn();
  render(
    <EnumChoice
      label="List density"
      icon="views"
      value="compact"
      options={options}
      onChange={change}
    />,
  );
  expect(screen.getByLabelText("List density, Compact")).toBeVisible();
  const selected = screen.getByRole("combobox", { name: "List density" });
  expect(selected).toHaveValue("compact");
  expect(screen.getByTestId("native-image")).toHaveAttribute("data-uri", "file://2.png");
  fireEvent.change(selected, { target: { value: "compact" } });
  expect(change).not.toHaveBeenCalled();
  fireEvent.change(selected, { target: { value: "comfortable" } });
  expect(change).toHaveBeenCalledExactlyOnceWith("comfortable");
});
it("reflects controlled selection and keeps every native option disabled while saving", () => {
  const change = vi.fn();
  const { rerender } = render(
    <EnumChoice label="List density" value="compact" options={options} onChange={change} />,
  );
  rerender(
    <EnumChoice
      label="List density"
      value="comfortable"
      options={options}
      onChange={change}
      disabled
    />,
  );
  expect(screen.getByLabelText("List density, Comfortable")).toBeVisible();
  expect(screen.getByRole("combobox", { name: "List density" })).toHaveValue("comfortable");
  expect(screen.getByRole("combobox", { name: "List density" })).toBeDisabled();
  fireEvent.change(screen.getByRole("combobox", { name: "List density" }), {
    target: { value: "compact" },
  });
  expect(change).not.toHaveBeenCalled();
});
