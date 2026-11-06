import { Pressable } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme, workspaceColor } from "../theme";
import { GlassSurface } from "./glass-surface";
import { Icon } from "./icons";

/** Primary capture on standalone record pages, clear of the bottom safe area. */
export function FloatingAdd({ label, onPress }: { label: string; onPress: () => void }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <GlassSurface
      style={{
        position: "absolute",
        right: 20,
        bottom: Math.max(insets.bottom, 16),
        width: 56,
        height: 56,
        borderRadius: 28,
        overflow: "hidden",
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        onPress={onPress}
        style={{ flex: 1, alignItems: "center", justifyContent: "center" }}
      >
        <Icon name="add" size={27} color={workspaceColor(t, "tasks")} />
      </Pressable>
    </GlassSurface>
  );
}
