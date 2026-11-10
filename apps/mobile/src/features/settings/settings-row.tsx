import type { ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { Icon, type IconName } from "../../components/icons";
import { type SettingsWorkspace, useSettingsAccent } from "../../components/settings-accent";
import { SettingLabel, SettingValue } from "../../components/settings-row-content";
import { spacing, useTheme, workspaceColor } from "../../theme";
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

/** A discrete action uses the same row geometry as Settings navigation, without a chevron. */
export function SettingsActionRow({
  label,
  icon,
  leading,
  onPress,
  disabled = false,
  destructive = false,
}: {
  label: string;
  icon?: IconName;
  leading?: ReactNode;
  onPress: () => void;
  disabled?: boolean;
  destructive?: boolean;
}) {
  const t = useTheme();
  const accent = useSettingsAccent();
  const color = destructive ? t.destructive : accent;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({ ...rowStyle, opacity: disabled ? 0.4 : pressed ? 0.6 : 1 })}
    >
      {leading ?? (icon ? <Icon name={icon} color={color} size={22} /> : null)}
      <SettingLabel style={{ color }}>{label}</SettingLabel>
    </Pressable>
  );
}
/** Configuration metadata is readable content, never a disabled button. */
export function SettingsDetailRow({
  label,
  value,
  icon,
  attention = false,
}: {
  label: string;
  value: string;
  icon?: IconName;
  attention?: boolean;
}) {
  const t = useTheme();
  return (
    <View accessibilityLabel={`${label}, ${value}`} style={rowStyle}>
      {icon && <Icon name={icon} size={22} color={t.secondary} />}
      <SettingLabel>{label}</SettingLabel>
      <SettingValue style={attention ? { color: t.warning } : undefined}>{value}</SettingValue>
    </View>
  );
}
export function SettingsIdentity({
  name,
  detail,
  leading,
}: {
  name: string;
  detail?: string | null;
  leading: ReactNode;
}) {
  const t = useTheme();
  return (
    <View style={{ ...rowStyle, gap: spacing.lg }}>
      {leading}
      <View style={{ flex: 1, minWidth: 0, gap: spacing.xs }}>
        <Text style={{ color: t.ink, fontSize: 20, fontWeight: "600" }}>{name}</Text>
        {detail && (
          <Text selectable style={{ color: t.secondary, fontSize: 15 }}>
            {detail}
          </Text>
        )}
      </View>
    </View>
  );
}
const rowStyle = {
  minHeight: 56,
  paddingHorizontal: spacing.lg,
  paddingVertical: spacing.md,
  flexDirection: "row" as const,
  alignItems: "center" as const,
  gap: spacing.md,
};
