import type { PropsWithChildren, ReactNode } from "react";
import { Children, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  type TextInputProps,
  View,
} from "react-native";
import { radius, spacing, touchTarget, useTheme } from "../../theme";
import { Icon, type IconName } from "../icons";
import { useSettingsAccent, useSettingsAccentColor } from "../settings-accent";
import { SettingLabel, SettingValue } from "../settings-row-content";
import { formBlock, formRow } from "./form-row";

export { formBlock, formRow, insetRow } from "./form-row";
export { SectionFootnote, SectionItem, SectionNote } from "./section-content";

export function Action({
  label,
  onPress,
  disabled = false,
  destructive = false,
  accessibilityLabel,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  destructive?: boolean;
  /** Only when the visible label alone is ambiguous to a screen reader. */
  accessibilityLabel?: string;
}) {
  const t = useTheme();
  const accent = useSettingsAccent();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: touchTarget,
        minWidth: touchTarget,
        borderRadius: radius.control,
        justifyContent: "center",
        paddingHorizontal: spacing.md,
        opacity: disabled ? 0.4 : pressed ? 0.6 : 1,
      })}
    >
      <Text
        style={{
          fontSize: 16,
          fontWeight: "600",
          color: destructive ? t.destructive : accent,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}
/**
 * The trailing commands of an inline editor (Cancel, Clear, Done, Save): one right-aligned
 * line of text actions, so every expanding row ends the same way. Each action pads its own
 * label, so the line is pulled out by that padding to end the last label on the row's edge.
 * `inset` adds the row's side padding; leave it off inside a container that already pads.
 */
export function Actions({ children, inset = true }: PropsWithChildren<{ inset?: boolean }>) {
  return (
    <View
      style={{
        flexDirection: "row",
        flexWrap: "wrap",
        justifyContent: "flex-end",
        gap: spacing.sm,
        marginHorizontal: (inset ? spacing.lg : 0) - spacing.md,
      }}
    >
      {children}
    </View>
  );
}
/** A single rounded group: rows own their padding; the group owns its surface and seams. */
export function Group({ children }: PropsWithChildren) {
  const t = useTheme();
  return (
    <View
      testID="form-group"
      style={{
        backgroundColor: t.surface,
        borderRadius: radius.panel,
        borderCurve: "continuous",
        overflow: "hidden",
      }}
    >
      {Children.toArray(children).map((child, index) => (
        <View key={(child as { key?: string }).key ?? index}>
          {index > 0 && (
            <View
              style={{
                height: StyleSheet.hairlineWidth,
                backgroundColor: t.line,
                marginLeft: spacing.lg,
              }}
            />
          )}
          {child}
        </View>
      ))}
    </View>
  );
}
export function Section({ title, children }: PropsWithChildren<{ title?: string }>) {
  const t = useTheme();
  return (
    <View style={{ marginBottom: spacing.xl }}>
      {title && (
        <Text
          accessibilityRole="header"
          style={{
            color: t.secondary,
            fontSize: 13,
            fontWeight: "500",
            marginBottom: spacing.sm,
            marginHorizontal: spacing.lg,
          }}
        >
          {title}
        </Text>
      )}
      <Group>{children}</Group>
    </View>
  );
}
export function NavigationRow({
  label,
  icon,
  onPress,
  disabled = false,
}: {
  label: string;
  icon: IconName;
  onPress: () => void;
  disabled?: boolean;
}) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.row, { opacity: disabled ? 0.4 : pressed ? 0.6 : 1 }]}
    >
      <Icon name={icon} color={t.secondary} size={22} />
      <SettingLabel>{label}</SettingLabel>
      <Icon name="chevron" color={t.secondary} size={16} />
    </Pressable>
  );
}
export function SearchField(props: TextInputProps & { accessibilityLabel: string }) {
  const t = useTheme();
  return (
    <TextInput
      placeholderTextColor={t.secondary}
      returnKeyType="search"
      autoCorrect={false}
      {...props}
      style={[
        {
          color: t.ink,
          backgroundColor: t.surface,
          borderRadius: radius.control,
          minHeight: touchTarget,
          paddingHorizontal: spacing.lg,
          paddingVertical: spacing.md,
          fontSize: 17,
          marginBottom: spacing.md,
        },
        props.style,
      ]}
    />
  );
}
export function ToggleRow({
  label,
  icon,
  value,
  onChange,
  disabled,
}: {
  label: string;
  icon?: IconName;
  value: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  const t = useTheme();
  const fallbackAccent = useSettingsAccent();
  const accent = useSettingsAccentColor(fallbackAccent, t.secondary);
  return (
    <View style={styles.settingRow}>
      {icon && <Icon name={icon} size={22} color={t.secondary} />}
      <SettingLabel>{label}</SettingLabel>
      <Switch
        accessibilityLabel={label}
        value={value}
        onValueChange={onChange}
        disabled={disabled}
        trackColor={{ true: accent }}
      />
    </View>
  );
}
/** Preserve FlatList virtualization while rounding only each group's outer corners. */
export function groupEdges(first: boolean, last: boolean) {
  return {
    borderTopLeftRadius: first ? radius.panel : 0,
    borderTopRightRadius: first ? radius.panel : 0,
    borderBottomLeftRadius: last ? radius.panel : 0,
    borderBottomRightRadius: last ? radius.panel : 0,
    overflow: "hidden" as const,
    borderCurve: "continuous" as const,
  };
}
/** A record's title, with an optional leading identity (icon or icon button) in a fixed slot. */
export function TitleField({
  label,
  leading,
  ...props
}: TextInputProps & { label: string; leading?: ReactNode }) {
  const t = useTheme();
  return (
    <View style={{ padding: spacing.lg, flexDirection: "row", alignItems: "flex-start" }}>
      {leading && (
        <View
          testID="title-field-leading"
          style={{ width: touchTarget, marginRight: spacing.lg, alignItems: "center" }}
        >
          {leading}
        </View>
      )}
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={t.secondary}
        multiline
        scrollEnabled={false}
        maxLength={240}
        {...props}
        style={[
          {
            flex: 1,
            color: t.ink,
            fontSize: 24,
            fontWeight: "600",
            minHeight: 56,
            padding: 0,
            textAlignVertical: "top",
          },
          props.style,
        ]}
      />
    </View>
  );
}
export function Field({
  label,
  icon,
  compact = true,
  ...props
}: TextInputProps & { label: string; compact?: boolean; icon?: IconName }) {
  const [editing, setEditing] = useState(false);
  const [inlineEditing, setInlineEditing] = useState(false);
  const t = useTheme();
  const expandedValue =
    !props.secureTextEntry &&
    (!!props.multiline ||
      props.keyboardType === "email-address" ||
      props.autoComplete === "email" ||
      (props.value?.length ?? 0) > 24);
  if (compact && !editing && (!expandedValue || inlineEditing))
    return (
      <View style={styles.settingRow}>
        {icon && <Icon name={icon} size={22} color={t.secondary} />}
        <SettingLabel>{label}</SettingLabel>
        <TextInput
          {...props}
          accessibilityLabel={label}
          placeholderTextColor={t.secondary}
          // The input stays compact so the row keeps its standard height; the slop keeps
          // the full row height tappable.
          hitSlop={{ top: spacing.md, bottom: spacing.md }}
          onFocus={(event) => {
            setInlineEditing(true);
            props.onFocus?.(event);
          }}
          onBlur={(event) => {
            setInlineEditing(false);
            props.onBlur?.(event);
          }}
          style={{
            color: t.ink,
            fontSize: 17,
            minHeight: 32,
            width:
              props.keyboardType === "number-pad" || props.keyboardType === "numeric"
                ? "30%"
                : "55%",
            textAlign: "right",
            padding: 0,
          }}
        />
      </View>
    );
  if (compact && !editing)
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}, ${props.value || "Not set"}`}
        disabled={props.editable === false}
        accessibilityState={{ disabled: props.editable === false }}
        onPress={() => setEditing(true)}
        style={styles.settingRow}
      >
        {icon && <Icon name={icon} size={22} color={t.secondary} />}
        <SettingLabel>{label}</SettingLabel>
        <SettingValue style={{ color: props.value ? t.ink : t.secondary }}>
          {props.value || props.placeholder || "Not set"}
        </SettingValue>
      </Pressable>
    );
  return (
    <View style={formBlock}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
        {icon && <Icon name={icon} size={22} color={t.secondary} />}
        <SettingLabel>{label}</SettingLabel>
        {compact && <Action label="Done" onPress={() => setEditing(false)} />}
      </View>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={t.secondary}
        {...props}
        autoFocus={compact && editing}
        onBlur={(event) => {
          setEditing(false);
          props.onBlur?.(event);
        }}
        style={[
          {
            color: t.ink,
            fontSize: 17,
            minHeight: touchTarget,
            padding: 0,
            textAlignVertical: props.multiline ? "top" : "center",
          },
          props.style,
        ]}
      />
    </View>
  );
}
export function FormBody({ children }: PropsWithChildren) {
  const t = useTheme();
  return (
    <ScrollView
      automaticallyAdjustKeyboardInsets
      keyboardDismissMode="interactive"
      keyboardShouldPersistTaps="handled"
      contentInsetAdjustmentBehavior="automatic"
      style={{ flex: 1, backgroundColor: t.canvas }}
      contentContainerStyle={{ padding: spacing.page, paddingBottom: 112 }}
    >
      {children}
    </ScrollView>
  );
}
export const styles = StyleSheet.create({
  settingRow: formRow,
  row: formRow,
  toolbar: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.xs },
  divider: { height: StyleSheet.hairlineWidth },
});
