import { Pressable, Text, View } from "react-native";
import { Icon, type IconName } from "../../components/icons";
import { useTheme } from "../../theme";
export function SettingsRow({
  label,
  value,
  icon,
  onPress,
}: {
  label: string;
  value?: string;
  icon?: IconName;
  onPress: () => void;
}) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={value ? `${label}, ${value}` : label}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 52,
        paddingHorizontal: 16,
        paddingVertical: 12,
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        opacity: pressed ? 0.6 : 1,
      })}
    >
      {icon && <Icon name={icon} color={t.ink} size={22} />}
      <Text style={{ color: t.ink, fontSize: 17, flex: 1 }}>{label}</Text>
      {value && <Text style={{ color: t.secondary, fontSize: 16, flexShrink: 1 }}>{value}</Text>}
      <View>
        <Icon name="chevron" color={t.secondary} size={16} />
      </View>
    </Pressable>
  );
}
