import { MemoryIcon, SettingsIcon } from "@/components/icons";

/** Settings-owned navigation metadata. The shell decides placement. */
export const settingsNavigationItem = {
  icon: SettingsIcon,
  label: "Settings",
  path: "/settings",
};

export const memorySettingsSection = { icon: MemoryIcon, id: "memory", label: "Memory" } as const;
