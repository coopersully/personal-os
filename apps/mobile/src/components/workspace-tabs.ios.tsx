import { NativeTabs } from "expo-router/native-tabs";
import { type WorkspaceWithPages, workspacePages } from "../navigation/workspace-pages";
import { useTheme, workspaceColor } from "../theme";
import { icons, selectedIcons } from "./icons";

/** UIKit owns the tab bar, its glass selection, dragging, and transitions. */
export function WorkspaceTabs({ workspace }: { workspace: WorkspaceWithPages }) {
  const theme = useTheme();
  return (
    <NativeTabs
      tintColor={workspaceColor(theme, workspace)}
      iconColor={{ default: theme.secondary, selected: workspaceColor(theme, workspace) }}
    >
      {workspacePages[workspace].map((page) => (
        <NativeTabs.Trigger key={page.name} name={page.name} accessibilityLabel={page.label}>
          <NativeTabs.Trigger.Label>{page.label}</NativeTabs.Trigger.Label>
          <NativeTabs.Trigger.Icon
            renderingMode="template"
            src={{ default: icons[page.icon], selected: selectedIcons[page.icon] }}
          />
        </NativeTabs.Trigger>
      ))}
    </NativeTabs>
  );
}
