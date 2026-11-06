import { usePathname } from "expo-router";
import { Platform, Pressable, StyleSheet } from "react-native";
import { useTheme, workspaceColor } from "../theme";
import { GlassSurface } from "./glass-surface";
import { Icon } from "./icons";

/** Layout placeholder only; creating domain records is not wired yet. */
export function WorkspaceAddButton() {
  const owner = usePathname().split("/")[1];
  const theme = useTheme();
  if (owner !== "tasks" && owner !== "mail" && owner !== "calendar") return null;
  return (
    <GlassSurface
      style={[styles.floating, Platform.OS === "ios" && owner !== "calendar" && { bottom: 96 }]}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          owner === "mail" ? "Compose mail" : owner === "tasks" ? "Add task" : "Add event"
        }
        accessibilityHint="Layout preview; not available yet"
        accessibilityState={{ disabled: true }}
        disabled
        style={styles.button}
      >
        <Icon name="add" size={27} color={workspaceColor(theme, owner)} />
      </Pressable>
    </GlassSurface>
  );
}
const styles = StyleSheet.create({
  floating: {
    position: "absolute",
    right: 20,
    bottom: 16,
    width: 56,
    height: 56,
    borderRadius: 28,
    overflow: "hidden",
  },
  button: { flex: 1, alignItems: "center", justifyContent: "center" },
});
