import DateTimePicker from "@expo/ui/community/datetime-picker";
import { localDateAt, localDateTimeToUtc } from "@personal-os/domain";
import { useEffect, useState } from "react";
import { Pressable, View } from "react-native";
import { Action, Actions, formRow } from "../../components/forms/form-rows";
import { useSettingsAccent } from "../../components/settings-accent";
import { SettingLabel, SettingValue } from "../../components/settings-row-content";
import { spacing, useTheme } from "../../theme";
import { useAuth } from "../auth/context";
import type { DateFieldProps } from "./date-field";
import { isPastDue, relativeDueDate } from "./due-date";
export function DateField({
  label,
  value,
  onChange,
  dateOnly = false,
  due = false,
}: DateFieldProps) {
  const t = useTheme();
  const accent = useSettingsAccent();
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
        style={({ pressed }) => [formRow, { opacity: pressed ? 0.6 : 1 }]}
      >
        <SettingLabel>{label}</SettingLabel>
        <SettingValue numberOfLines={1} style={overdue ? { color: t.destructive } : undefined}>
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
        </SettingValue>
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
        style={({ pressed }) => [formRow, { opacity: pressed ? 0.6 : 1 }]}
      >
        <SettingLabel>{label}</SettingLabel>
        <SettingValue style={{ color: accent }}>Not set</SettingValue>
      </Pressable>
    );
  return (
    <View>
      <View style={formRow}>
        <SettingLabel style={overdue ? { color: t.destructive } : undefined}>
          {label}
          {overdue ? " · Overdue" : ""}
        </SettingLabel>
      </View>
      {due && (
        <View
          style={{
            flexDirection: "row",
            flexWrap: "wrap",
            gap: spacing.xs,
            // Each shortcut pads its own label; start the first label on the row's edge.
            paddingHorizontal: spacing.lg - spacing.md,
          }}
        >
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
      <View style={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.md, gap: spacing.sm }}>
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
          accentColor={overdue ? t.destructive : accent}
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
            accentColor={overdue ? t.destructive : accent}
            mode="time"
            display="spinner"
            onChange={(_event, date) => {
              if (date) onChange(date.toISOString());
            }}
          />
        )}
        <Actions inset={false}>
          <Action
            label="Clear"
            onPress={() => {
              if (value) onChange(null);
              setEditing(false);
            }}
          />
          <Action label="Done" onPress={() => setEditing(false)} />
        </Actions>
      </View>
    </View>
  );
}
