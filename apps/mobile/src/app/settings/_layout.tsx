import { router, Stack, useGlobalSearchParams, usePathname } from "expo-router";
import { editorDismissOptions, stackChromeOptions } from "../../components/editor-header";
import {
  SettingsAccentProvider,
  settingsWorkspaceForRoute,
} from "../../components/settings-accent";
import { useTheme } from "../../theme";
export const unstable_settings = { anchor: "index" };
export default function SettingsLayout() {
  const t = useTheme();
  const path = usePathname();
  const params = useGlobalSearchParams<{ workspace?: string; domain?: string }>();
  const workspace = settingsWorkspaceForRoute(path, params);
  return (
    <SettingsAccentProvider workspace={workspace}>
      <Stack screenOptions={stackChromeOptions(t)}>
        <Stack.Screen
          name="index"
          options={{
            title: "Settings",
            ...editorDismissOptions({
              label: "Back",
              onPress: () => (router.canGoBack() ? router.back() : router.replace("/")),
            }),
          }}
        />
      </Stack>
    </SettingsAccentProvider>
  );
}
