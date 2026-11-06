import type { PropsWithChildren } from "react";
import { Children, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  type TextInputProps,
  View,
} from "react-native";
import { Icon, type IconName } from "../../components/icons";
import { radius, spacing, touchTarget, useTheme, workspaceColor } from "../../theme";

export function Action({
  label,
  onPress,
  disabled = false,
  destructive = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  destructive?: boolean;
}) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
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
          color: destructive ? t.destructive : workspaceColor(t, "tasks"),
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}
export function Heading({
  children,
  icon,
  compact = false,
}: PropsWithChildren<{ icon?: IconName; compact?: boolean }>) {
  const t = useTheme();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "flex-start",
        gap: spacing.md,
        marginBottom: compact ? 0 : spacing.lg,
      }}
    >
      {icon && (
        <View style={{ paddingTop: 3 }}>
          <Icon name={icon} size={28} color={t.ink} />
        </View>
      )}
      <Text
        accessibilityRole="header"
        style={{ color: t.ink, fontSize: 28, fontWeight: "700", flexShrink: 1 }}
      >
        {children}
      </Text>
    </View>
  );
}
/** A single rounded group: children own row padding; the group owns its seams. */
export function Group({ children }: PropsWithChildren) {
  const t = useTheme();
  return (
    <View
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
      <Text style={{ color: t.ink, fontSize: 17, flex: 1 }}>{label}</Text>
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
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  const t = useTheme();
  return (
    <View style={styles.settingRow}>
      <Text style={{ color: t.ink, fontSize: 17, flex: 1 }}>{label}</Text>
      <Switch
        accessibilityLabel={label}
        value={value}
        onValueChange={onChange}
        disabled={disabled}
        trackColor={{ true: workspaceColor(t, "tasks") }}
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
export function TitleField({ label, ...props }: TextInputProps & { label: string }) {
  const t = useTheme();
  return (
    <View style={{ padding: spacing.lg }}>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={t.secondary}
        multiline
        scrollEnabled={false}
        maxLength={240}
        {...props}
        style={[
          {
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
  compact = true,
  ...props
}: TextInputProps & { label: string; compact?: boolean }) {
  const [editing, setEditing] = useState(false);
  const t = useTheme();
  if (compact && !props.multiline)
    return (
      <View style={styles.settingRow}>
        <Text style={{ color: t.ink, fontSize: 17, flex: 1 }}>{label}</Text>
        <TextInput
          {...props}
          accessibilityLabel={label}
          placeholderTextColor={t.secondary}
          style={{
            color: t.ink,
            fontSize: 17,
            minHeight: 44,
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
        onPress={() => setEditing(true)}
        style={styles.settingRow}
      >
        <Text style={{ color: t.ink, fontSize: 17, flex: 1 }}>{label}</Text>
        <Text
          numberOfLines={1}
          style={{
            color: props.value ? t.ink : t.secondary,
            fontSize: 17,
            maxWidth: "55%",
            textAlign: "right",
          }}
        >
          {props.value || props.placeholder || "Not set"}
        </Text>
      </Pressable>
    );
  return (
    <View style={{ padding: spacing.lg, gap: spacing.sm }}>
      <Text style={{ fontSize: 13, color: t.secondary }}>{label}</Text>
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
export type Option = { value: string; label: string };
export function Choice({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  options: readonly Option[];
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const t = useTheme();
  const [expanded, setExpanded] = useState(false);
  const choose = () => setExpanded(!expanded);
  return (
    <View>
      <Pressable
        disabled={disabled}
        accessibilityRole="button"
        accessibilityState={{
          disabled: !!disabled,
          expanded,
        }}
        accessibilityLabel={`${label}, ${options.find((option) => option.value === value)?.label ?? "None"}`}
        onPress={choose}
        style={{
          minHeight: 56,
          alignItems: "center",
          opacity: disabled ? 0.4 : 1,
          padding: spacing.lg,
          flexDirection: "row",
          justifyContent: "space-between",
          gap: spacing.md,
        }}
      >
        <Text style={{ color: t.ink, fontSize: 17, flexShrink: 1 }}>{label}</Text>
        <Text
          numberOfLines={1}
          style={{
            color: workspaceColor(t, "tasks"),
            fontSize: 17,
            flexShrink: 1,
            textAlign: "right",
            maxWidth: "55%",
          }}
        >
          {options.find((option) => option.value === value)?.label ?? "None"}
        </Text>
      </Pressable>
      {expanded &&
        options.map((option) => (
          <Pressable
            key={option.value}
            accessibilityRole="radio"
            accessibilityState={{ checked: option.value === value }}
            onPress={() => {
              onChange(option.value);
              setExpanded(false);
            }}
            style={styles.settingRow}
          >
            <Text style={{ color: t.ink, fontSize: 17, flex: 1 }}>{option.label}</Text>
            {option.value === value && <Icon name="save" color={workspaceColor(t, "tasks")} />}
          </Pressable>
        ))}
    </View>
  );
}
export function State({
  loading,
  retry,
  empty,
}: {
  loading?: boolean;
  retry?: () => void;
  empty?: string;
}) {
  const t = useTheme();
  return (
    <View style={{ padding: spacing.xl, alignItems: "center", gap: spacing.sm }}>
      {loading ? (
        <ActivityIndicator accessibilityLabel="Loading tasks" color={t.ink} />
      ) : retry ? (
        <Action label="Retry loading" onPress={retry} />
      ) : (
        <Text style={{ color: t.secondary, textAlign: "center", fontSize: 16 }}>
          {empty ?? "Nothing here yet."}
        </Text>
      )}
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
export function confirm(title: string, message: string, accept: () => void, destructive = false) {
  if (Platform.OS === "web") {
    if (globalThis.confirm(`${title}\n\n${message}`)) accept();
  } else
    Alert.alert(title, message, [
      { text: "Cancel", style: "cancel" },
      { text: "Continue", style: destructive ? "destructive" : "default", onPress: accept },
    ]);
}
export const styles = StyleSheet.create({
  settingRow: {
    minHeight: 56,
    padding: spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  row: {
    minHeight: 56,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  toolbar: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.xs },
  divider: { height: StyleSheet.hairlineWidth },
});
