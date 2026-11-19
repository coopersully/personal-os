import { NativeTabs } from "expo-router/native-tabs";
import { type WorkspaceWithPages, workspacePages } from "../navigation/workspace-pages";
import { useTheme, workspaceColor } from "../theme";
import { icons, selectedIcons } from "./icons";
import type { WorkspaceTabBadges } from "./workspace-tabs";

/** UIKit owns the tab bar, its glass selection, dragging, and transitions. */
export function WorkspaceTabs({
  workspace,
  badges,
}: {
  workspace: WorkspaceWithPages;
  badges?: WorkspaceTabBadges;
}) {
  const theme = useTheme();
  return (
    <NativeTabs
      tintColor={workspaceColor(theme, workspace)}
      iconColor={{ default: theme.secondary, selected: workspaceColor(theme, workspace) }}
    >
      {workspacePages[workspace].map((page) => {
        const badge = badges?.[page.name];
        return (
          <NativeTabs.Trigger
            key={page.name}
            name={page.name}
            accessibilityLabel={badge ? `${page.label}, ${badge.label}` : page.label}
            // Pages reserve the fixed search header themselves. Otherwise the tabs switch a tab's
            // first scroll view to UIKit's automatic insets on top of that padding.
            disableAutomaticContentInsets
          >
            <NativeTabs.Trigger.Label>{page.label}</NativeTabs.Trigger.Label>
            <NativeTabs.Trigger.Icon
              renderingMode="template"
              src={{ default: icons[page.icon], selected: selectedIcons[page.icon] }}
            />
            {badge && <NativeTabs.Trigger.Badge>{badge.value}</NativeTabs.Trigger.Badge>}
          </NativeTabs.Trigger>
        );
      })}
    </NativeTabs>
  );
}
