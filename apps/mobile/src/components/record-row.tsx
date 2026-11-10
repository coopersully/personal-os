import type { ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { useTheme } from "../theme";
import { Icon } from "./icons";

/** Trailing values belong to the heading line, never the description's width track. */
export function RecordRow({
  title,
  subtitle,
  value,
  leading,
  centered = false,
  valueTone,
  accessibilityHint,
  onPress,
}: {
  title: string;
  subtitle?: string;
  value?: string;
  leading: ReactNode;
  centered?: boolean;
  valueTone?: "attention" | "incorrect";
  accessibilityHint?: string;
  onPress?: () => void;
}) {
  const t = useTheme();
  const body = (
    <View
      style={{
        flexDirection: "row",
        alignItems: centered ? "center" : "flex-start",
        gap: 12,
        paddingVertical: 14,
        minHeight: 56,
      }}
    >
      <View style={{ paddingTop: centered ? 0 : 2 }}>{leading}</View>
      <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
        <View
          style={{ flexDirection: "row", alignItems: centered ? "center" : "flex-start", gap: 12 }}
        >
          <Text style={{ flex: 1, color: t.ink, fontSize: 16, fontWeight: "500" }}>{title}</Text>
          {!!value && (
            <Text
              style={{
                color:
                  valueTone === "attention"
                    ? t.warning
                    : valueTone === "incorrect"
                      ? t.destructive
                      : t.ink,
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
          {!!onPress && <Icon name="chevron" size={16} color={t.secondary} />}
        </View>
        {!!subtitle && (
          <Text style={{ color: t.secondary, fontSize: 15, lineHeight: 21 }}>{subtitle}</Text>
        )}
      </View>
    </View>
  );
  return onPress ? (
    <Pressable accessibilityRole="button" accessibilityHint={accessibilityHint} onPress={onPress}>
      {body}
    </Pressable>
  ) : (
    body
  );
}
