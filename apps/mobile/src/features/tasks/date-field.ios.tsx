import DateTimePicker from "@expo/ui/community/datetime-picker";
import { localDateAt, localDateTimeToUtc } from "@personal-os/domain";
import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { spacing, touchTarget, useTheme, workspaceColor } from "../../theme";
import { useAuth } from "../auth/context";
import type { DateFieldProps } from "./date-field";
import { isPastDue, relativeDueDate } from "./due-date";
import { Action } from "./ui";
export function DateField({
  label,
  value,
  onChange,
  dateOnly = false,
  due = false,
}: DateFieldProps) {
  const t = useTheme();
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  const [editing, setEditing] = useState(false);
  const { state } = useAuth();
  const timezone = state.user?.planningTimezone;
  const dateString = (date: Date) => {
    const local = localDateAt(date, timezone as string);
    return `${local.year}-${String(local.month).padStart(2, "0")}-${String(local.day).padStart(2, "0")}`;
  };
  if (!timezone) return null;
  const overdue = due && isPastDue(value, now);
  if (value && !editing)
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}${overdue ? ", overdue" : ""}, ${value}`}
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
        <Text
          numberOfLines={1}
          style={{ color: overdue ? t.destructive : t.secondary, fontSize: 17, maxWidth: "60%" }}
        >
          {dateOnly
            ? new Intl.DateTimeFormat(undefined, {
                timeZone: timezone,
                month: "short",
                day: "numeric",
                year: "numeric",
              }).format(
                localDateTimeToUtc(
                  {
                    year: Number(value.slice(0, 4)),
                    month: Number(value.slice(5, 7)),
                    day: Number(value.slice(8, 10)),
                  },
                  720,
                  timezone,
                ),
              )
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
  if (!value && !editing)
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Set ${label.toLowerCase()}`}
        onPress={() => {
          setEditing(true);
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
        alignItems: "stretch",
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center" }}>
        <Text style={{ color: overdue ? t.destructive : t.ink, fontSize: 17, flex: 1 }}>
          {label}
          {overdue ? " · Overdue" : ""}
        </Text>
        <Action label="Done" onPress={() => setEditing(false)} />
      </View>
      {due && (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.xs }}>
          {(
            [
              { value: "hour", label: "In 1 hour" },
              { value: "tomorrow", label: "Tomorrow, 9 AM" },
              { value: "week", label: "In 1 week, 9 AM" },
            ] as const
          ).map((option) => (
            <Action
              key={option.value}
              label={option.label}
              onPress={() => {
                onChange(relativeDueDate(option.value, timezone));
                setEditing(false);
              }}
            />
          ))}
        </View>
      )}
      <View style={{ alignItems: "stretch", gap: spacing.sm }}>
        <DateTimePicker
          value={
            !value
              ? new Date(now)
              : dateOnly
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
          accentColor={workspaceColor(t, "tasks")}
          mode="date"
          display="inline"
          onChange={(_event, date) => {
            if (date) onChange(dateOnly ? dateString(date) : date.toISOString());
          }}
        />
        {!dateOnly && (
          <DateTimePicker
            value={new Date(value ?? now)}
            timeZoneName={timezone}
            accentColor={workspaceColor(t, "tasks")}
            mode="time"
            display="spinner"
            onChange={(_event, date) => {
              if (date) onChange(date.toISOString());
            }}
          />
        )}
        <Action
          label="Clear"
          onPress={() => {
            if (value) onChange(null);
            setEditing(false);
          }}
        />
      </View>
    </View>
  );
}
