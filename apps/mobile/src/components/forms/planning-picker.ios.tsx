import DateTimePicker from "@expo/ui/community/datetime-picker";
import { localDateAt, localDateTimeToUtc } from "@personal-os/domain";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useTheme } from "../../theme";
import type { PlanningPickerProps } from "./planning-picker";
export function PlanningPicker({
  label,
  value,
  onChange,
  mode,
  timeZone,
  optional = false,
}: PlanningPickerProps) {
  const t = useTheme();
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
  return (
    <View style={{ paddingVertical: 8 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}, ${value || "Not set"}`}
        onPress={() => setEditing(!editing)}
        style={{ minHeight: 56, flexDirection: "row", alignItems: "center", gap: 12 }}
      >
        <Text style={{ color: t.ink, flex: 1 }}>{label}</Text>
        <Text style={{ color: t.secondary }}>{value || "Not set"}</Text>
      </Pressable>
      {editing && (
        <>
          <DateTimePicker
            value={date}
            timeZoneName={timeZone}
            mode={mode}
            display={mode === "date" ? "inline" : "spinner"}
            onChange={(_event, next) => {
              if (!next) return;
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
            <Text style={{ color: t.information }}>Done</Text>
          </Pressable>
          {optional && (
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                onChange("");
                setEditing(false);
              }}
              style={{ minHeight: 44, justifyContent: "center" }}
            >
              <Text style={{ color: t.information }}>Clear {label.toLowerCase()}</Text>
            </Pressable>
          )}
        </>
      )}
    </View>
  );
}
