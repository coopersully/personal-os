import { Pressable, Text, View } from "react-native";
import { spacing, touchTarget, useTheme } from "../theme";
import { Icon } from "./icons";

/**
 * The in-page way back to a parent list that is shown in place rather than pushed on a stack
 * (a mailbox's conversations over the mailbox list). A pushed screen uses the native stack
 * back button instead. The chevron is the registry glyph mirrored, never a typed character,
 * so it scales, tints and aligns like every other icon.
 */
export function BackLink({
  label,
  accessibilityLabel,
  onPress,
}: {
  /** The parent's name, such as "Mailboxes". */
  label: string;
  accessibilityLabel: string;
  onPress: () => void;
}) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: touchTarget,
        flexDirection: "row",
        alignItems: "center",
        alignSelf: "flex-start",
        gap: spacing.xs,
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <View testID="back-link-chevron" style={{ transform: [{ rotate: "180deg" }] }}>
        <Icon name="chevron" size={16} color={t.information} />
      </View>
      <Text style={{ color: t.information, fontSize: 17 }}>{label}</Text>
    </Pressable>
  );
}
