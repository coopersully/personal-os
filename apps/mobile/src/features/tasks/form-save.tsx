import { KeyboardAvoidingView, Platform, Pressable } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { GlassSurface } from "../../components/glass-surface";
import { Icon } from "../../components/icons";
import { useTheme, workspaceColor } from "../../theme";
export function FormSave({ disabled, onPress }: { disabled: boolean; onPress: () => void }) {
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
            opacity: disabled ? 0.35 : 1,
          }}
        >
          <Icon name="save" size={27} color={workspaceColor(t, "tasks")} />
        </Pressable>
      </GlassSurface>
    </KeyboardAvoidingView>
  );
}
