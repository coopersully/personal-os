import { ApiClientError } from "@personal-os/api-client";
import {
  type PropsWithChildren,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useRef,
} from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { toast } from "sonner-native";
import { Icon, type IconName } from "../../components/icons";
import { Screen } from "../../components/screen";
import { radius, spacing, useTheme, workspaceColor } from "../../theme";
import { useFinanceRefresh } from "./data";

export function FinanceScreen({ title, children }: PropsWithChildren<{ title: string }>) {
  useFinanceRefresh();
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
const readNotices = new Map<string, unknown>();
const readHosts = new Map<string, Set<() => Promise<void>>>();
function retryRead(key: string) {
  void readHosts.get(key)?.values().next().value?.();
}

export function ReadState({
  query,
  children,
}: {
  query: {
    feedbackKey?: string;
    isPending: boolean;
    isError: boolean;
    error?: unknown;
    data: unknown;
    refetch: () => Promise<{ isError: boolean }>;
    isFetchNextPageError?: boolean;
    fetchNextPage?: () => Promise<{ isError: boolean }>;
  };
  children: ReactNode;
}) {
  const t = useTheme();
  const instanceId = useId();
  const toastId = query.feedbackKey ?? instanceId;
  const latest = useRef(query);
  latest.current = query;
  const busy = useRef(false);
  const retry = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    toast.loading("Refreshing finance data…", { id: toastId });
    try {
      const current = latest.current;
      const result = await (current.isFetchNextPageError && current.fetchNextPage
        ? current.fetchNextPage()
        : current.refetch());
      if (!readHosts.has(toastId)) return;
      if (result.isError) throw new Error("Read failed");
      toast.success("Finance data refreshed", { id: toastId });
    } catch {
      if (readHosts.has(toastId))
        toast.error("Couldn’t refresh finance data", {
          id: toastId,
          action: { label: "Retry", onClick: () => retryRead(toastId) },
        });
    } finally {
      busy.current = false;
    }
  }, [toastId]);
  useEffect(() => {
    const hosts = readHosts.get(toastId) ?? new Set();
    hosts.add(retry);
    readHosts.set(toastId, hosts);
    return () => {
      hosts.delete(retry);
      if (!hosts.size) {
        readHosts.delete(toastId);
        readNotices.delete(toastId);
        toast.dismiss(toastId);
      }
    };
  }, [toastId, retry]);
  useEffect(() => {
    if (query.isError && query.error && !busy.current && readNotices.get(toastId) !== query.error) {
      readNotices.set(toastId, query.error);
      toast.error("Couldn’t load finance data", {
        id: toastId,
        action: { label: "Retry", onClick: () => retryRead(toastId) },
      });
    } else if (!query.isError && readNotices.has(toastId) && !busy.current) {
      readNotices.delete(toastId);
      toast.dismiss(toastId);
    }
  }, [query.isError, query.error, toastId]);
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
    return <FinanceRow title="Retry loading" icon="disconnected" onPress={() => void retry()} />;
  return <>{children}</>;
}
