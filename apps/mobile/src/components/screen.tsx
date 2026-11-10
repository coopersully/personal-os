import type { PropsWithChildren } from "react";
import {
  Animated,
  Platform,
  ScrollView,
  type ScrollViewProps,
  StyleSheet,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { regionMotion, useWorkspaceMotion } from "../navigation/workspace-motion";
import { useTheme } from "../theme";
import { useWorkspaceHeaderInset } from "./workspace-header-inset";

export function Screen({
  children,
  chrome = false,
  scroll = true,
  edgeToEdge = false,
  backgroundColor,
  bounces = true,
  onScroll,
}: PropsWithChildren<{
  chrome?: boolean;
  scroll?: boolean;
  edgeToEdge?: boolean;
  backgroundColor?: string;
  bounces?: boolean;
  onScroll?: ScrollViewProps["onScroll"];
}>) {
  const theme = useTheme();
  const motion = useWorkspaceMotion();
  const insets = useSafeAreaInsets();
  const headerInset = useWorkspaceHeaderInset();
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: backgroundColor ?? theme.canvas,
        paddingTop: 0,
      }}
    >
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
            {scroll ? (
              <ScrollView
                bounces={bounces}
                onScroll={onScroll}
                scrollEventThrottle={16}
                scrollIndicatorInsets={{ top: headerInset }}
                automaticallyAdjustKeyboardInsets
                keyboardDismissMode="interactive"
                contentInsetAdjustmentBehavior={headerInset > 0 ? "never" : "automatic"}
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={[
                  styles.content,
                  edgeToEdge && { paddingHorizontal: 0, maxWidth: undefined, flexGrow: 1 },
                  {
                    paddingTop: edgeToEdge ? 0 : headerInset + (chrome ? 4 : 16),
                    paddingBottom: Math.max(insets.bottom, 20),
                  },
                ]}
              >
                {children}
              </ScrollView>
            ) : (
              <View
                style={[
                  styles.content,
                  { flex: 1, minHeight: 0, paddingTop: headerInset, paddingBottom: insets.bottom },
                ]}
              >
                {children}
              </View>
            )}
          </Animated.View>
        </Animated.View>
      </View>
    </View>
  );
}
const styles = StyleSheet.create({
  content: { width: "100%", maxWidth: 620, alignSelf: "center", paddingHorizontal: 20 },
});
