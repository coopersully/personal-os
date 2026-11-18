// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { ProviderMark } from "./provider-mark";

vi.mock("react", async () => {
  const { createRequire } = await import("node:module");
  return createRequire(`${process.cwd()}/package.json`)("react");
});
const h = vi.hoisted(() => {
  vi.stubGlobal("require", (path: string) => path);
  return { dark: false };
});
vi.mock("../../theme", () => ({ useTheme: () => ({ dark: h.dark, ink: "#202024" }) }));
vi.mock("react-native", () => ({
  Image: ({
    source,
    accessibilityLabel,
    style,
    accessible,
  }: {
    source: string;
    accessibilityLabel?: string;
    style: { width: number; height: number; tintColor?: string };
    accessible: boolean;
  }) => (
    <img
      src={source}
      alt={accessibilityLabel ?? ""}
      aria-hidden={!accessible}
      width={style.width}
      height={style.height}
      data-tint={style.tintColor}
    />
  ),
  Text: ({ children }: PropsWithChildren) => <span>{children}</span>,
  View: ({
    children,
    accessibilityLabel,
    accessible,
  }: PropsWithChildren<{ accessibilityLabel?: string; accessible: boolean }>) => (
    <figure aria-label={accessibilityLabel} aria-hidden={!accessible}>
      {children}
    </figure>
  ),
}));
afterEach(() => {
  cleanup();
  h.dark = false;
});
it("keeps Google full-color source unchanged across themes without native tinting", () => {
  const view = render(<ProviderMark brand=" Google " />);
  expect(screen.getByRole("img", { name: "Google" })).toHaveAttribute(
    "src",
    expect.stringContaining("google-color.png"),
  );
  expect(screen.getByRole("img")).not.toHaveAttribute("data-tint");
  h.dark = true;
  view.rerender(<ProviderMark brand="google" size={28} />);
  expect(screen.getByRole("img")).toHaveAttribute(
    "src",
    expect.stringContaining("google-color.png"),
  );
  expect(screen.getByRole("img")).toHaveAttribute("width", "28");
});
it.each([
  ["apple", "Apple"],
  ["icloud", "iCloud"],
  ["x", "X"],
])("uses canonical %s raster variants and never an invented monogram for an available mark", (brand, label) => {
  const view = render(<ProviderMark brand={brand} />);
  expect(screen.getByRole("img", { name: label })).toHaveAttribute(
    "src",
    expect.stringContaining(`${brand}-light.png`),
  );
  h.dark = true;
  view.rerender(<ProviderMark brand={brand} />);
  expect(screen.getByRole("img", { name: label })).toHaveAttribute(
    "src",
    expect.stringContaining(`${brand}-dark.png`),
  );
});
it("hides a decorative provider mark from duplicate announcements and reserves monograms for unavailable brands", () => {
  const view = render(<ProviderMark brand="google" decorative />);
  expect(screen.queryByRole("img")).toBeNull();
  view.rerender(<ProviderMark brand="Future provider" />);
  expect(screen.getByRole("figure", { name: "Future provider" })).toHaveTextContent("F");
  expect(screen.queryByRole("img")).toBeNull();
  view.rerender(<ProviderMark brand="" />);
  expect(screen.getByText("?")).toBeTruthy();
});
