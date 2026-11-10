import { useRef } from "react";
import { Text, TextInput, View } from "react-native";
import { useTheme } from "../../theme";
export type PlanningPickerProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  mode: "date" | "time";
  timeZone: string;
  optional?: boolean;
  disabled?: boolean;
};
/** Web fallback; iOS resolves the native implementation. */
export function PlanningPicker({
  label,
  value,
  onChange,
  mode,
  disabled = false,
}: PlanningPickerProps) {
  const disabledRef = useRef(disabled);
  disabledRef.current = disabled;
  const t = useTheme();
  return (
    <View>
      <Text style={{ color: t.secondary }}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        value={value}
        editable={!disabled}
        onChangeText={(next) => {
          if (!disabledRef.current) onChange(next);
        }}
        placeholder={mode === "date" ? "YYYY-MM-DD" : "HH:mm"}
        style={{ minHeight: 44, color: t.ink }}
      />
    </View>
  );
}
