import { type ReactNode, useState } from "react";
import { Modal, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Icon } from "../../components/icons";
import { spacing, useTheme } from "../../theme";
import { Card, Copy } from "./ui";

/** Calculation disclosure stays separate from the metric's destination. */
export function OverviewMetric({
  label,
  value,
  status,
  compact = false,
  accent = false,
  details,
  onPress,
}: {
  label: string;
  value: string;
  status?: string;
  compact?: boolean;
  accent?: boolean;
  details: ReactNode;
  onPress: () => void;
}) {
  const [open, setOpen] = useState(false);
  const t = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <>
      <Card accent={accent}>
        <View style={{ flexDirection: "row", alignItems: "center", marginVertical: -spacing.sm }}>
          <View style={{ flex: 1 }}>
            <Copy secondary>{label}</Copy>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`About ${label.toLowerCase()}`}
            onPress={() => setOpen(true)}
            style={{
              width: 44,
              height: 44,
              alignItems: "center",
              justifyContent: "center",
              marginRight: -spacing.sm,
            }}
          >
            <Icon name="info" size={18} color={t.secondary} />
          </Pressable>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${label}, ${value}`}
          accessibilityHint="Opens details"
          onPress={onPress}
          style={{ minHeight: 44, justifyContent: "center" }}
        >
          <Text
            style={{
              color: t.ink,
              fontSize: compact ? 22 : 30,
              fontWeight: "600",
              fontVariant: ["tabular-nums"],
            }}
          >
            {value}
          </Text>
        </Pressable>
        {status && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${label}: ${status}. Show explanation`}
            onPress={() => setOpen(true)}
            style={{ minHeight: 44, flexDirection: "row", alignItems: "center", gap: spacing.sm }}
          >
            <Icon name="attention" size={16} color={t.secondary} />
            <Copy secondary>{status}</Copy>
          </Pressable>
        )}
      </Card>
      {open && (
        <Modal
          visible
          animationType="slide"
          presentationStyle="pageSheet"
          onRequestClose={() => setOpen(false)}
        >
          <View
            style={{
              flex: 1,
              backgroundColor: t.canvas,
              paddingTop: spacing.lg,
              paddingHorizontal: spacing.page,
              paddingBottom: Math.max(insets.bottom, spacing.page),
            }}
          >
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: spacing.sm,
                marginBottom: spacing.lg,
              }}
            >
              <Text
                accessibilityRole="header"
                style={{ flex: 1, color: t.ink, fontSize: 24, fontWeight: "600" }}
              >
                {label}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close information"
                onPress={() => setOpen(false)}
                style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}
              >
                <Icon name="cancel" color={t.ink} />
              </Pressable>
            </View>
            <ScrollView contentContainerStyle={{ gap: spacing.lg, paddingBottom: spacing.lg }}>
              <Text
                style={{
                  color: t.ink,
                  fontSize: 30,
                  fontWeight: "600",
                  fontVariant: ["tabular-nums"],
                }}
              >
                {value}
              </Text>
              {details}
            </ScrollView>
          </View>
        </Modal>
      )}
    </>
  );
}
