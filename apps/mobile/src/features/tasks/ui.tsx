import type { PropsWithChildren } from "react";
import { ActivityIndicator, Alert, Platform, Text, View } from "react-native";
import { Action } from "../../components/forms/form-rows";
import { Icon, type IconName } from "../../components/icons";
import { spacing, useTheme } from "../../theme";

// Form and settings rows are shared chrome; Tasks composes them rather than owning copies.
export {
  Action,
  Field,
  FormBody,
  Group,
  groupEdges,
  NavigationRow,
  SearchField,
  Section,
  styles,
  TitleField,
  ToggleRow,
} from "../../components/forms/form-rows";

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
export type Option = { value: string; label: string; icon?: IconName; color?: string };
export { EnumChoice as Choice } from "../../components/forms/enum-choice";
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
export function confirm(title: string, message: string, accept: () => void, destructive = false) {
  if (Platform.OS === "web") {
    if (globalThis.confirm(`${title}\n\n${message}`)) accept();
  } else
    Alert.alert(title, message, [
      { text: "Cancel", style: "cancel" },
      { text: "Continue", style: destructive ? "destructive" : "default", onPress: accept },
    ]);
}
