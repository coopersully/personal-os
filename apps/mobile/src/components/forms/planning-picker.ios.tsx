import DateTimePicker from "@expo/ui/community/datetime-picker";
import { localDateAt, localDateTimeToUtc } from "@personal-os/domain";
import { useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useTheme } from "../../theme";
import { useSettingsAccentColor } from "../settings-accent";
import { SettingLabel, SettingValue } from "../settings-row-content";
import type { PlanningPickerProps } from "./planning-picker";
export function PlanningPicker({
  label,
  value,
  onChange,
  mode,
  timeZone,
  optional = false,
  disabled = false,
}: PlanningPickerProps) {
  const disabledRef = useRef(disabled);
  disabledRef.current = disabled;
  const t = useTheme();
  const accent = useSettingsAccentColor(t.information);
  const [editing, setEditing] = useState(false);
  const today = localDateAt(new Date(), timeZone);
  const day =
    mode === "date" && value
      ? {
          year: Number(value.slice(0, 4)),
          month: Number(value.slice(5, 7)),
          day: Number(value.slice(8, 10)),
        }
      : today;
  const minutes =
    mode === "time" && value ? Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5)) : 720;
  const date = localDateTimeToUtc(day, minutes, timeZone);
  const displayValue = value
    ? new Intl.DateTimeFormat(
        undefined,
        mode === "date"
          ? { timeZone, month: "short", day: "numeric", year: "numeric" }
          : { timeZone, hour: "numeric", minute: "2-digit" },
      ).format(date)
    : "Not set";
  return (
    <View style={{ paddingVertical: 8 }}>
      <Pressable
        disabled={disabled}
        accessibilityState={{ disabled }}
        accessibilityRole="button"
        accessibilityLabel={`${label}, ${displayValue}`}
        onPress={() => {
          if (!disabledRef.current) setEditing(!editing);
        }}
        style={{ minHeight: 56, flexDirection: "row", alignItems: "center", gap: 12 }}
      >
        <SettingLabel>{label}</SettingLabel>
        <SettingValue>{displayValue}</SettingValue>
      </Pressable>
      {editing && (
        <>
          <DateTimePicker
            value={date}
            disabled={disabled}
            accentColor={accent}
            timeZoneName={timeZone}
            mode={mode}
            display={mode === "date" ? "inline" : "spinner"}
            onChange={(_event, next) => {
              if (disabledRef.current || !next) return;
              if (mode === "date") {
                const local = localDateAt(next, timeZone);
                onChange(
                  `${local.year}-${String(local.month).padStart(2, "0")}-${String(local.day).padStart(2, "0")}`,
                );
              } else {
                onChange(
                  new Intl.DateTimeFormat("en-GB", {
                    timeZone,
                    hour: "2-digit",
                    minute: "2-digit",
                    hourCycle: "h23",
                  }).format(next),
                );
              }
            }}
          />
          <Pressable
            accessibilityRole="button"
            onPress={() => setEditing(false)}
            style={{ minHeight: 44, justifyContent: "center" }}
          >
            <Text style={{ color: accent }}>Done</Text>
          </Pressable>
          {optional && (
            <Pressable
              accessibilityRole="button"
              disabled={disabled}
              accessibilityState={{ disabled }}
              onPress={() => {
                if (disabledRef.current) return;
                onChange("");
                setEditing(false);
              }}
              style={{ minHeight: 44, justifyContent: "center" }}
            >
              <Text style={{ color: accent }}>Clear {label.toLowerCase()}</Text>
            </Pressable>
          )}
        </>
      )}
    </View>
  );
}
