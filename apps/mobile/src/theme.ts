import { useColorScheme } from "react-native";
import { workspacePalette } from "./navigation/workspace-palette";

const common = {
  mail: "#d4005a",
  tasks: "#7928ff",
  calendar: "#005be6",
  finances: "#007f3d",
  white: "#ffffff",
};
export function useTheme() {
  const dark = useColorScheme() === "dark";
  return {
    ...common,
    dark,
    canvas: dark ? "#18181b" : "#faf9f7",
    surface: dark ? "#27272b" : "#efeeeb",
    ink: dark ? "#fafafa" : "#202024",
    secondary: dark ? "#b4b4bd" : "#626268",
    line: dark ? "#3b3b40" : "#dad8d3",
    warning: dark ? "#efbe6a" : "#89501b",
    success: dark ? "#71d5a0" : "#23784f",
    information: dark ? "#78aaff" : "#235ec5",
  };
}
export const workspaces = [
  { id: "index", label: "today", icon: "today" },
  { id: "mail", label: "mail", icon: "mail" },
  { id: "tasks", label: "tasks", icon: "tasks" },
  { id: "calendar", label: "calendar", icon: "calendar" },
  { id: "finances", label: "finances", icon: "finances" },
] as const;

/** Shared workspace tint for navigation, with legible variants on dark material. */
export function workspaceColor(theme: ReturnType<typeof useTheme>, id: string) {
  const palette = workspacePalette[theme.dark ? "dark" : "light"];
  return id in palette ? palette[id as keyof typeof palette] : theme.ink;
}
