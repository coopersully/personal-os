import {
  useSaveWorkspacePreferences,
  useWorkspacePreferences,
} from "../workspace-settings/preferences";
export const useTodayPreferences = () => useWorkspacePreferences("today");
export const useSaveTodayPreferences = () => useSaveWorkspacePreferences("today");
