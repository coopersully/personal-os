import DateTimePicker from "@expo/ui/community/datetime-picker";
import { localDateAt, localDateTimeToUtc } from "@personal-os/domain";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { spacing, touchTarget, useTheme, workspaceColor } from "../../theme";
import { useAuth } from "../auth/context";
import type { DateFieldProps } from "./date-field";
import { Action } from "./ui";
export function DateField({ label, value, onChange, dateOnly = false }: DateFieldProps) {
  const t = useTheme();
  const [editing, setEditing] = useState(false);
  const { state } = useAuth();
  const timezone = state.user?.planningTimezone;
  const dateString = (date: Date) => {
    const local = localDateAt(date, timezone as string);
    return `${local.year}-${String(local.month).padStart(2, "0")}-${String(local.day).padStart(2, "0")}`;
  };
  if (!timezone) return null;
  if (value && !editing)
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}, ${value}`}
        onPress={() => setEditing(true)}
        style={{
          padding: spacing.lg,
          minHeight: 56,
          flexDirection: "row",
          alignItems: "center",
          gap: spacing.md,
        }}
      >
        <Text style={{ color: t.ink, fontSize: 17, flex: 1 }}>{label}</Text>
        <Text numberOfLines={1} style={{ color: t.secondary, fontSize: 17, maxWidth: "60%" }}>
          {dateOnly
            ? value
            : new Intl.DateTimeFormat(undefined, {
                timeZone: timezone,
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
              }).format(new Date(value))}
        </Text>
      </Pressable>
    );
  if (!value)
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Set ${label.toLowerCase()}`}
        onPress={() => {
          setEditing(true);
          const date = new Date();
          onChange(dateOnly ? dateString(date) : date.toISOString());
        }}
        style={({ pressed }) => ({
          minHeight: touchTarget,
          padding: spacing.lg,
          flexDirection: "row",
          alignItems: "center",
          gap: spacing.md,
          opacity: pressed ? 0.6 : 1,
        })}
      >
        <Text style={{ color: t.ink, fontSize: 17, flex: 1 }}>{label}</Text>
        <Text style={{ color: workspaceColor(t, "tasks"), fontSize: 17 }}>Not set</Text>
      </Pressable>
    );
  return (
    <View
      style={{
        padding: spacing.lg,
        gap: spacing.sm,
        flexDirection: "row",
        alignItems: "center",
        flexWrap: "wrap",
      }}
    >
      <Text style={{ color: t.ink, fontSize: 17, flexGrow: 1 }}>{label}</Text>
      <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap" }}>
        <DateTimePicker
          value={
            dateOnly
              ? localDateTimeToUtc(
                  {
                    year: Number(value.slice(0, 4)),
                    month: Number(value.slice(5, 7)),
                    day: Number(value.slice(8, 10)),
                  },
                  720,
                  timezone,
                )
              : new Date(value)
          }
          timeZoneName={timezone}
          mode={dateOnly ? "date" : "datetime"}
          display="compact"
          onChange={(_event, date) => {
            if (date) onChange(dateOnly ? dateString(date) : date.toISOString());
          }}
        />
        <Action
          label="Clear"
          onPress={() => {
            onChange(null);
            setEditing(false);
          }}
        />
        <Action label="Done" onPress={() => setEditing(false)} />
      </View>
    </View>
  );
}
