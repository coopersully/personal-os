import DateTimePicker from "@expo/ui/community/datetime-picker";
import { localDateAt, localDateTimeToUtc } from "@personal-os/domain";
import { useRef, useState } from "react";
import { Pressable, View } from "react-native";
import { spacing, useTheme } from "../../theme";
import { useSettingsAccentColor } from "../settings-accent";
import { SettingLabel, SettingValue } from "../settings-row-content";
import { Action, Actions, formRow } from "./form-rows";
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
    <View>
      <Pressable
        disabled={disabled}
        accessibilityState={{ disabled }}
        accessibilityRole="button"
        accessibilityLabel={`${label}, ${displayValue}`}
        onPress={() => {
          if (!disabledRef.current) setEditing(!editing);
        }}
        style={({ pressed }) => [formRow, { opacity: disabled ? 0.4 : pressed ? 0.6 : 1 }]}
      >
        <SettingLabel>{label}</SettingLabel>
        <SettingValue>{displayValue}</SettingValue>
      </Pressable>
      {editing && (
        <View style={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.md, gap: spacing.sm }}>
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
          <Actions inset={false}>
            {optional && (
              <Action
                label={`Clear ${label.toLowerCase()}`}
                disabled={disabled}
                onPress={() => {
                  if (disabledRef.current) return;
                  onChange("");
                  setEditing(false);
                }}
              />
            )}
            <Action label="Done" onPress={() => setEditing(false)} />
          </Actions>
        </View>
      )}
    </View>
  );
}
