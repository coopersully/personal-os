import {
  useSaveWorkspacePreferences,
  useWorkspacePreferences,
} from "../workspace-settings/preferences";

export function useMailLayoutPreferences() {
  const settings = useWorkspacePreferences("mail");
  const save = useSaveWorkspacePreferences("mail");
  return { settings, save };
}
