import { router, usePathname } from "expo-router";
import { Platform, Pressable, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { supportsProminentCompose } from "../navigation/native-compose";
import { useTheme, workspaceColor } from "../theme";
import { GlassSurface } from "./glass-surface";
import { Icon } from "./icons";

/** Contextual capture for Tasks; other workspaces retain layout placeholders. */
export function WorkspaceAddButton() {
  const [, owner, page] = usePathname().split("/");
  const container =
    owner === "tasks" && (page === "lists" || page === "projects")
      ? page === "lists"
        ? "list"
        : "project"
      : null;
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  if (owner === "mail" && supportsProminentCompose(Platform.OS, Platform.Version)) return null;
  if (owner === "tasks" && page === "views") return null;
  if (owner !== "tasks" && owner !== "mail" && owner !== "calendar") return null;
  return (
    <GlassSurface
      style={[
        styles.floating,
        Platform.OS === "ios" &&
          owner !== "calendar" && {
            bottom: owner === "mail" ? Math.max(16, insets.bottom - 8) : 96,
          },
      ]}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          container
            ? `Add ${container}`
            : owner === "mail"
              ? "Compose mail"
              : owner === "tasks"
                ? "Add task"
                : "Add event"
        }
        accessibilityHint={
          container
            ? `Create a ${container}`
            : owner === "tasks"
              ? "Create a task or reminder"
              : owner === "mail"
                ? "Write a message"
                : "Layout preview; not available yet"
        }
        accessibilityState={{ disabled: owner === "calendar" }}
        disabled={owner === "calendar"}
        onPress={() =>
          router.push(
            owner === "mail"
              ? "/mail-compose"
              : container
                ? { pathname: "/task-container", params: { kind: container } }
                : { pathname: "/task-editor", params: { kind: "task" } },
          )
        }
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
