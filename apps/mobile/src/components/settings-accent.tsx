import { createContext, type PropsWithChildren, useContext } from "react";
import { useTheme, workspaceColor } from "../theme";

export type SettingsWorkspace = "tasks" | "mail" | "calendar" | "finances";
const SettingsAccentContext = createContext<SettingsWorkspace | null | undefined>(undefined);
export function SettingsAccentProvider({
  workspace = null,
  children,
}: PropsWithChildren<{ workspace?: SettingsWorkspace | null }>) {
  return (
    <SettingsAccentContext.Provider value={workspace}>{children}</SettingsAccentContext.Provider>
  );
}
export function useSettingsAccentColor(fallbackColor: string, neutralColor?: string) {
  const workspace = useContext(SettingsAccentContext);
  const theme = useTheme();
  return workspace === undefined
    ? fallbackColor
    : workspace === null
      ? (neutralColor ?? theme.ink)
      : workspaceColor(theme, workspace);
}
export function useSettingsAccent(fallbackWorkspace = "tasks") {
  const theme = useTheme();
  return useSettingsAccentColor(workspaceColor(theme, fallbackWorkspace));
}
export function settingsWorkspaceForRoute(
  path: string,
  params: { workspace?: string | string[]; domain?: string | string[] } = {},
): SettingsWorkspace | null {
  if (path === "/settings" || path === "/settings/") return null;
  const isWorkspace = (value: unknown): value is SettingsWorkspace =>
    typeof value === "string" && ["tasks", "mail", "calendar", "finances"].includes(value);
  const segment = path.split("/")[2];
  if (isWorkspace(segment)) return segment;
  const explicit = Array.isArray(params.workspace) ? params.workspace[0] : params.workspace;
  if (isWorkspace(explicit)) return explicit;
  const domain = Array.isArray(params.domain) ? params.domain[0] : params.domain;
  return path === "/settings/guidance" && isWorkspace(domain) ? domain : null;
}
