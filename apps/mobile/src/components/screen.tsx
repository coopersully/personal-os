import type { PropsWithChildren } from "react";
import { Animated, Platform, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { regionMotion, useWorkspaceMotion } from "../navigation/workspace-motion";
import { useTheme } from "../theme";

export function Screen({ children, chrome = false }: PropsWithChildren<{ chrome?: boolean }>) {
  const theme = useTheme();
  const motion = useWorkspaceMotion();
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, backgroundColor: theme.canvas, paddingTop: 0 }}>
      <View style={{ flex: 1, overflow: "hidden" }}>
        <Animated.View
          style={[{ flex: 1 }, chrome && motion && regionMotion(motion.workspaceProgress, 20)]}
        >
          <Animated.View
            style={[
              { flex: 1 },
              chrome &&
                Platform.OS !== "ios" &&
                motion &&
                regionMotion(motion.pageProgress, 24, "x"),
            ]}
          >
            <ScrollView
              contentInsetAdjustmentBehavior={
                Platform.OS === "ios" ? "automatic" : chrome ? "never" : "automatic"
              }
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={[
                styles.content,
                {
                  paddingTop: chrome ? 4 : 16,
                  paddingBottom: chrome ? 20 : Math.max(insets.bottom, 20),
                },
              ]}
            >
              {children}
            </ScrollView>
          </Animated.View>
        </Animated.View>
      </View>
    </View>
  );
}
const styles = StyleSheet.create({
  content: { width: "100%", maxWidth: 620, alignSelf: "center", paddingHorizontal: 20 },
});
