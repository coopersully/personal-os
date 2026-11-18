import type { ReactNode } from "react";
import { Pressable, Text, useWindowDimensions, View } from "react-native";
import { formRow } from "../../components/forms/form-row";
import { Icon, type IconName } from "../../components/icons";
import { type SettingsWorkspace, useSettingsAccent } from "../../components/settings-accent";
import { SettingDetail, SettingLabel, SettingValue } from "../../components/settings-row-content";
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
      style={({ pressed }) => ({ ...rowStyle, opacity: pressed ? 0.6 : 1 })}
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
      <SettingsRowText label={label} value={value} />
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
      <SettingsRowText label={label} value={value} attention={attention} />
    </View>
  );
}

/** Large text needs separate lines so the trailing value cannot squeeze the label. */
function SettingsRowText({
  label,
  value,
  attention = false,
}: {
  label: string;
  value?: string;
  attention?: boolean;
}) {
  const t = useTheme();
  const { fontScale } = useWindowDimensions();
  const stacked = fontScale >= 1.3 && !!value;
  const content = (
    <>
      <SettingLabel style={stacked ? { flex: 0 } : undefined}>{label}</SettingLabel>
      {value && (
        <SettingValue
          style={{
            ...(stacked ? { maxWidth: "100%", textAlign: "left" } : {}),
            ...(attention ? { color: t.warning } : {}),
          }}
        >
          {value}
        </SettingValue>
      )}
    </>
  );
  return stacked ? (
    <View style={{ flex: 1, minWidth: 0, flexDirection: "column", gap: spacing.xs }}>
      {content}
    </View>
  ) : (
    content
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
        {detail && <SettingDetail selectable>{detail}</SettingDetail>}
      </View>
    </View>
  );
}
const rowStyle = formRow;
