import { KeyboardAvoidingView, Platform, Pressable } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme, workspaceColor } from "../../theme";
import { GlassSurface } from "../glass-surface";
import { Icon } from "../icons";
export function FormSave({
  disabled,
  onPress,
  workspace = "tasks",
}: {
  disabled: boolean;
  onPress: () => void;
  workspace?: string;
}) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <KeyboardAvoidingView
      pointerEvents="box-none"
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={{ position: "absolute", bottom: 0, right: 20 }}
    >
      <GlassSurface
        style={{
          width: 56,
          height: 56,
          borderRadius: 28,
          overflow: "hidden",
          marginBottom: Math.max(insets.bottom, 16),
        }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Save changes"
          accessibilityState={{ disabled }}
          disabled={disabled}
          onPress={onPress}
          style={{
            flex: 1,
            alignItems: "center",
            justifyContent: "center",
            opacity: disabled ? 0.7 : 1,
          }}
        >
          <Icon name="save" size={27} color={disabled ? t.ink : workspaceColor(t, workspace)} />
        </Pressable>
      </GlassSurface>
    </KeyboardAvoidingView>
  );
}
