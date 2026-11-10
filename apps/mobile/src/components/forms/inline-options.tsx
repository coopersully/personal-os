import { Pressable, Text, View } from "react-native";
import { spacing, useTheme } from "../../theme";
import { Icon, type IconName } from "../icons";
import { useSettingsAccent } from "../settings-accent";

/** Short settings choices expand in place; labels lead and selection checks trail. */
export function InlineOptions({
  value,
  options,
  onChange,
}: {
  value: string | null;
  options: { label: string; value: string; icon?: IconName }[];
  onChange: (value: string) => void;
}) {
  const t = useTheme();
  const accent = useSettingsAccent();
  return (
    <View style={{ paddingLeft: spacing.md }}>
      {options.map((option) => (
        <Pressable
          key={option.value}
          accessibilityRole="radio"
          accessibilityLabel={option.label}
          accessibilityState={{ checked: value === option.value }}
          onPress={() => onChange(option.value)}
          style={{ minHeight: 44, flexDirection: "row", alignItems: "center", gap: spacing.md }}
        >
          {option.icon && <Icon name={option.icon} color={t.secondary} size={20} />}
          <Text style={{ flex: 1, color: t.ink, fontSize: 16 }}>{option.label}</Text>
          {value === option.value && <Icon name="save" color={accent} size={20} />}
        </Pressable>
      ))}
    </View>
  );
}
