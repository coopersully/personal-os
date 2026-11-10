import { Pressable, Text } from "react-native";
import { spacing, useTheme } from "../theme";
import { Icon, type IconName } from "./icons";

/** Compact reversible filters; selection is conveyed by tint, border and check. */
export function FilterChip({
  label,
  icon,
  selected,
  color,
  onPress,
}: {
  label: string;
  icon?: IconName;
  selected: boolean;
  color: string;
  onPress: () => void;
}) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={{
        minHeight: 44,
        borderRadius: 22,
        paddingHorizontal: 14,
        flexDirection: "row",
        alignItems: "center",
        gap: spacing.sm,
        backgroundColor: selected ? `${color}22` : t.surface,
        borderWidth: 1,
        borderColor: selected ? color : "transparent",
      }}
    >
      {icon && (
        <Icon name={icon} filled={selected} size={18} color={selected ? color : t.secondary} />
      )}
      <Text
        style={{
          color: selected ? color : t.ink,
          fontSize: 14,
          fontWeight: selected ? "600" : "400",
        }}
      >
        {label}
      </Text>
      {selected && <Icon name="save" size={14} color={color} />}
    </Pressable>
  );
}
