import DateTimePicker from "@expo/ui/community/datetime-picker";
import { Text, View } from "react-native";
import { spacing, useTheme } from "../../theme";
import type { DateFieldProps } from "./date-field";
import { Action } from "./ui";
export function DateField({ label, value, onChange, dateOnly = false }: DateFieldProps) {
  const t = useTheme();
  return (
    <View style={{ padding: spacing.lg, gap: spacing.sm }}>
      <Text style={{ color: t.secondary, fontSize: 13 }}>{label}</Text>
      {value ? (
        <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap" }}>
          <DateTimePicker
            value={new Date(dateOnly ? `${value}T12:00:00` : value)}
            mode={dateOnly ? "date" : "datetime"}
            display="compact"
            onChange={(_event, date) => {
              if (date)
                onChange(
                  dateOnly
                    ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
                    : date.toISOString(),
                );
            }}
          />
          <Action label="Clear" onPress={() => onChange(null)} />
        </View>
      ) : (
        <Action
          label="Add date"
          onPress={() => {
            const date = new Date();
            onChange(
              dateOnly
                ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
                : date.toISOString(),
            );
          }}
        />
      )}
    </View>
  );
}
