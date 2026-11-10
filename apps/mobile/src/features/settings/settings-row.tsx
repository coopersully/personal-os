import { Pressable, View } from "react-native";
import { Icon, type IconName } from "../../components/icons";
import type { SettingsWorkspace } from "../../components/settings-accent";
import { SettingLabel, SettingValue } from "../../components/settings-row-content";
import { useTheme, workspaceColor } from "../../theme";
export function SettingsRow({
  label,
  value,
  icon,
  workspace,
  onPress,
}: {
  label: string;
  value?: string;
  icon?: IconName;
  workspace?: SettingsWorkspace;
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
      {icon &&
        (workspace ? (
          <View
            style={{
              width: 32,
              height: 32,
              borderRadius: 8,
              flexShrink: 0,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: `${workspaceColor(t, workspace)}18`,
            }}
          >
            <Icon name={icon} color={workspaceColor(t, workspace)} size={22} />
          </View>
        ) : (
          <Icon name={icon} color={t.secondary} size={22} />
        ))}
      <SettingLabel>{label}</SettingLabel>
      {value && <SettingValue>{value}</SettingValue>}
      <View>
        <Icon name="chevron" color={t.secondary} size={16} />
      </View>
    </Pressable>
  );
}
