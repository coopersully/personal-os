import { router, Stack } from "expo-router";
import { editorDismissOptions } from "../../components/editor-header";
import { useTheme } from "../../theme";
export const unstable_settings = { initialRouteName: "index" };
export default function SettingsLayout() {
  const t = useTheme();
  return (
    <Stack
      screenOptions={{
        headerTintColor: t.ink,
        headerStyle: { backgroundColor: t.canvas },
        contentStyle: { backgroundColor: t.canvas },
        headerShadowVisible: false,
        headerBackButtonDisplayMode: "minimal",
      }}
    >
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
  );
}
