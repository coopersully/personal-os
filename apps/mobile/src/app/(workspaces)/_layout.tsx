import { Stack } from "expo-router";
import { Platform, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { WorkspaceAddButton } from "../../components/workspace-add-button";
import { WorkspaceDock } from "../../components/workspace-dock";
import { WorkspaceHeader } from "../../components/workspace-header";
import { WorkspaceMotion } from "../../navigation/workspace-motion";
import { useTheme } from "../../theme";

export default function WorkspaceLayout() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <WorkspaceMotion>
      <View
        style={{
          flex: 1,
          backgroundColor: theme.canvas,
          paddingTop: insets.top,
          paddingBottom: Platform.OS === "ios" ? 0 : Math.max(insets.bottom, 8),
        }}
      >
        <WorkspaceHeader />
        <View style={{ flex: 1, overflow: "hidden" }}>
          <Stack screenOptions={{ headerShown: false, animation: "none" }} />
          <WorkspaceAddButton />
        </View>
        {Platform.OS !== "ios" && <WorkspaceDock />}
      </View>
    </WorkspaceMotion>
  );
}
