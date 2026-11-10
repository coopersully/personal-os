import { router } from "expo-router";
import { NativeTabs } from "expo-router/native-tabs";
import { Platform } from "react-native";
import { useMailScope } from "../features/mail/scope";
import { supportsProminentCompose } from "../navigation/native-compose";
import { type WorkspaceWithPages, workspacePages } from "../navigation/workspace-pages";
import { useTheme, workspaceColor } from "../theme";
import { icons, selectedIcons } from "./icons";
import { RefreshScope } from "./refresh-context";

/** UIKit owns the tab bar, its glass selection, dragging, and transitions. */
export function WorkspaceTabs({ workspace }: { workspace: WorkspaceWithPages }) {
  const theme = useTheme();
  const { accountId } = useMailScope();
  return (
    <RefreshScope.Provider value={[workspace]}>
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
        {workspace === "mail" && supportsProminentCompose(Platform.OS, Platform.Version) && (
          <NativeTabs.Trigger
            name="compose"
            prominent
            disabled
            accessibilityLabel="Compose mail"
            listeners={{
              tabPress: () => router.push({ pathname: "/mail-compose", params: { accountId } }),
            }}
          >
            <NativeTabs.Trigger.Label hidden>Compose</NativeTabs.Trigger.Label>
            <NativeTabs.Trigger.Icon
              renderingMode="template"
              src={{ default: icons.add, selected: icons.add }}
            />
          </NativeTabs.Trigger>
        )}
      </NativeTabs>
    </RefreshScope.Provider>
  );
}
