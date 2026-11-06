// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { confirm } from "../features/tasks/ui";
import { GlassSurface } from "./glass-surface";

vi.mock("react", async () => {
  const { createRequire } = await import("node:module");
  return createRequire(`${process.cwd()}/package.json`)("react");
});
const h = vi.hoisted(() => ({
  platform: { OS: "ios" },
  dark: false,
  available: true,
  props: {} as Record<string, unknown>,
  alert: vi.fn(),
}));
vi.mock("react-native", async () => ({
  ...(await import("../../test/native")),
  Platform: h.platform,
  useColorScheme: () => (h.dark ? "dark" : "light"),
  Alert: { alert: h.alert },
}));
vi.mock("./icons", () => ({ Icon: () => null }));
vi.mock("expo-glass-effect", () => ({
  isLiquidGlassAvailable: () => h.available,
  GlassView: (props: PropsWithChildren<Record<string, unknown>>) => {
    h.props = props;
    return <div>{props.children}</div>;
  },
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
it("passes native glass configuration without an opaque material overlay", () => {
  h.platform.OS = "ios";
  h.available = true;
  render(
    <GlassSurface>
      <span>Visible control</span>
    </GlassSurface>,
  );
  expect(h.props.glassEffectStyle).toBe("regular");
  expect(h.props.style).toEqual([false, undefined]);
  expect(screen.getByText("Visible control")).toBeVisible();
});
it.each([false, true])("keeps a legible material fallback with dark mode %s", (dark) => {
  h.dark = dark;
  h.available = false;
  h.platform.OS = "web";
  const { rerender } = render(
    <GlassSurface>
      <span>Control</span>
    </GlassSurface>,
  );
  const style = (h.props.style as Record<string, unknown>[])[0];
  expect(style.backgroundColor).toBe(dark ? "rgba(45,45,52,0.62)" : "rgba(255,255,255,0.64)");
  expect(style.backdropFilter).toBe("blur(24px) saturate(180%)");
  expect(style.borderColor).toBe(dark ? "#ffffff30" : "#ffffffcc");
  h.platform.OS = "ios";
  rerender(
    <GlassSurface>
      <span>Control</span>
    </GlassSurface>,
  );
  expect((h.props.style as Record<string, unknown>[])[0]).not.toHaveProperty("backdropFilter");
  expect(screen.getByText("Control")).toBeVisible();
});
it.each([
  true,
  false,
])("requires native confirmation before executing an action (destructive=%s)", (destructive) => {
  h.platform.OS = "ios";
  const accept = vi.fn();
  confirm("Continue?", "Review this action.", accept, destructive);
  expect(accept).not.toHaveBeenCalled();
  const buttons = h.alert.mock.calls[0][2];
  expect(buttons[0]).toEqual({ text: "Cancel", style: "cancel" });
  expect(buttons[1].style).toBe(destructive ? "destructive" : "default");
  buttons[1].onPress();
  expect(accept).toHaveBeenCalledOnce();
});
