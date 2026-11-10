import { Text, TextInput, View } from "react-native";
import { useTheme } from "../../theme";
export type PlanningPickerProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  mode: "date" | "time";
  timeZone: string;
  optional?: boolean;
};
/** Web fallback; iOS resolves the native implementation. */
export function PlanningPicker({ label, value, onChange, mode }: PlanningPickerProps) {
  const t = useTheme();
  return (
    <View>
      <Text style={{ color: t.secondary }}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChange}
        placeholder={mode === "date" ? "YYYY-MM-DD" : "HH:mm"}
        style={{ minHeight: 44, color: t.ink }}
      />
    </View>
  );
}
