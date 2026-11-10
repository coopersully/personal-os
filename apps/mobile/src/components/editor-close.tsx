import { Pressable, Text } from "react-native";
import { spacing, touchTarget, useTheme } from "../theme";
export function EditorClose({
  label,
  onPress,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={{
        minHeight: touchTarget,
        paddingHorizontal: spacing.lg,
        justifyContent: "center",
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <Text style={{ color: t.ink, fontSize: 17 }}>{label}</Text>
    </Pressable>
  );
}
