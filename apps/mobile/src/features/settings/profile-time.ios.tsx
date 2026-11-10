import DateTimePicker from "@expo/ui/community/datetime-picker";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useTheme } from "../../theme";
import { Action, styles } from "../tasks/ui";
import type { ProfileTimeProps } from "./profile-time";
export function ProfileTime({ label, value, onChange, end, disabled }: ProfileTimeProps) {
  const t = useTheme();
  const [editing, setEditing] = useState(false);
  const date = new Date(Date.UTC(2000, 0, 1, 0, value === 1440 ? 0 : value));
  const display =
    value === 1440
      ? "Midnight (end of day)"
      : new Intl.DateTimeFormat(undefined, {
          hour: "numeric",
          minute: "2-digit",
          timeZone: "UTC",
        }).format(date);
  return (
    <View>
      <Pressable
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={`${label}, ${display}`}
        accessibilityState={{ expanded: editing, disabled }}
        onPress={() => setEditing(!editing)}
        style={styles.settingRow}
      >
        <Text style={{ color: t.ink, fontSize: 17, flex: 1 }}>{label}</Text>
        <Text style={{ color: t.secondary, fontSize: 17 }}>{display}</Text>
      </Pressable>
      {editing && !disabled && (
        <View>
          <DateTimePicker
            value={date}
            timeZoneName="UTC"
            mode="time"
            display="spinner"
            onChange={(_event, date) => {
              if (date) {
                const minute = date.getUTCHours() * 60 + date.getUTCMinutes();
                onChange(end && minute === 0 ? 1440 : minute);
              }
            }}
          />
          <Action label="Done" onPress={() => setEditing(false)} />
        </View>
      )}
    </View>
  );
}
