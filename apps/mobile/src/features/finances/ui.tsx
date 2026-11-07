import { ApiClientError } from "@personal-os/api-client";
import type { PropsWithChildren, ReactNode } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { Icon, type IconName } from "../../components/icons";
import { Screen } from "../../components/screen";
import { radius, spacing, useTheme, workspaceColor } from "../../theme";

export function FinanceScreen({ title, children }: PropsWithChildren<{ title: string }>) {
  const t = useTheme();
  return (
    <Screen chrome>
      <View style={{ gap: spacing.lg, paddingTop: 8 }}>
        <Text accessibilityRole="header" style={{ color: t.ink, fontSize: 28, fontWeight: "700" }}>
          {title}
        </Text>
        {children}
      </View>
    </Screen>
  );
}
export function Copy({ children, secondary = false }: PropsWithChildren<{ secondary?: boolean }>) {
  const t = useTheme();
  return (
    <Text style={{ color: secondary ? t.secondary : t.ink, fontSize: 15, lineHeight: 21 }}>
      {children}
    </Text>
  );
}
export function Section({ title, children }: PropsWithChildren<{ title: string }>) {
  const t = useTheme();
  return (
    <View style={{ gap: spacing.sm, marginTop: spacing.sm }}>
      <Text accessibilityRole="header" style={{ color: t.ink, fontSize: 19, fontWeight: "600" }}>
        {title}
      </Text>
      {children}
    </View>
  );
}
export function Card({
  children,
  accent = false,
  rows = false,
}: PropsWithChildren<{ accent?: boolean; rows?: boolean }>) {
  const t = useTheme();
  return (
    <View
      style={{
        backgroundColor: accent ? (t.dark ? "#173b2a" : "#e4f1e8") : t.surface,
        borderRadius: radius.panel,
        paddingHorizontal: spacing.lg,
        paddingVertical: rows ? 2 : spacing.lg,
        gap: rows ? 0 : spacing.md,
      }}
    >
      {children}
    </View>
  );
}
export function FinanceRow({
  title,
  subtitle,
  value,
  icon = "receipt",
  centered = false,
  onPress,
}: {
  title: string;
  subtitle?: string;
  value?: string;
  icon?: IconName;
  centered?: boolean;
  onPress?: () => void;
}) {
  const t = useTheme();
  const content = (
    <View
      style={{
        flexDirection: "row",
        alignItems: centered ? "center" : "flex-start",
        gap: 12,
        paddingVertical: 14,
        minHeight: 56,
      }}
    >
      <View style={{ paddingTop: centered ? 0 : 2 }}>
        <Icon name={icon} color={workspaceColor(t, "finances")} />
      </View>
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={{ color: t.ink, fontSize: 16, fontWeight: "500" }}>{title}</Text>
        {subtitle && <Copy secondary>{subtitle}</Copy>}
      </View>
      {value && (
        <Text
          style={{
            color: t.ink,
            fontSize: 15,
            fontWeight: "600",
            maxWidth: "42%",
            textAlign: "right",
            fontVariant: ["tabular-nums"],
          }}
        >
          {value}
        </Text>
      )}
      {onPress && <Icon name="chevron" size={16} color={t.secondary} />}
    </View>
  );
  return onPress ? (
    <Pressable accessibilityRole="button" onPress={onPress}>
      {content}
    </Pressable>
  ) : (
    content
  );
}
export function Metric({
  label,
  value,
  hint,
  onPress,
  compact = false,
  accent = false,
  children,
}: {
  compact?: boolean;
  accent?: boolean;
  children?: ReactNode;
  label: string;
  value: string;
  hint?: string;
  onPress?: () => void;
}) {
  const t = useTheme();
  const currency = value.match(/^([A-Z]{3})\s/);
  const content = (
    <Card accent={accent}>
      <View
        style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", gap: 8 }}
      >
        <Copy secondary>{label}</Copy>
        {currency && (
          <Text style={{ color: t.secondary, fontSize: 12, alignSelf: "center" }}>
            {currency[1]}
          </Text>
        )}
      </View>
      <Text
        style={{
          color: t.ink,
          fontSize: compact ? 22 : 30,
          fontWeight: "600",
          fontVariant: ["tabular-nums"],
        }}
      >
        {currency ? value.slice(currency[0].length) : value}
      </Text>
      {hint && <Copy secondary>{hint}</Copy>}
      {children}
    </Card>
  );
  return onPress ? (
    <Pressable accessibilityRole="button" onPress={onPress}>
      {content}
    </Pressable>
  ) : (
    content
  );
}
export function Segments<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: readonly T[];
  onChange: (value: T) => void;
}) {
  const t = useTheme();
  return (
    <View
      style={{
        flexDirection: "row",
        flexWrap: "wrap",
        backgroundColor: t.surface,
        borderRadius: radius.panel,
        padding: 4,
        gap: 4,
      }}
    >
      {options.map((option) => (
        <Pressable
          key={option}
          accessibilityRole="button"
          accessibilityState={{ selected: option === value }}
          onPress={() => onChange(option)}
          style={{
            flexGrow: 1,
            minHeight: 44,
            justifyContent: "center",
            alignItems: "center",
            paddingHorizontal: 12,
            borderRadius: radius.menu,
            backgroundColor: value === option ? t.canvas : "transparent",
          }}
        >
          <Text
            style={{
              color: value === option ? workspaceColor(t, "finances") : t.secondary,
              fontSize: 15,
              fontWeight: "600",
            }}
          >
            {option}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}
export function ReadState({
  query,
  children,
}: {
  query: {
    isPending: boolean;
    isError: boolean;
    error?: unknown;
    data: unknown;
    refetch: () => unknown;
  };
  children: ReactNode;
}) {
  const t = useTheme();
  if (query.isPending)
    return (
      <ActivityIndicator
        color={t.secondary}
        accessibilityLabel="Loading finance data"
        style={{ padding: 24 }}
      />
    );
  const unavailable =
    query.error instanceof ApiClientError && [401, 403, 404].includes(query.error.status);
  if (query.isError && (!query.data || unavailable))
    return (
      <FinanceRow title="Retry loading" icon="disconnected" onPress={() => void query.refetch()} />
    );
  return (
    <>
      {query.isError && (
        <FinanceRow
          title="Refresh saved data"
          icon="disconnected"
          onPress={() => void query.refetch()}
        />
      )}
      {children}
    </>
  );
}
