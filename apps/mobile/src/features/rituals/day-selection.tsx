import { Pressable, Text, View } from "react-native";
import { useTheme } from "../../theme";

const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export function DaySelection({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number[] | undefined;
  onChange: (value: number[] | undefined) => void;
}) {
  const t = useTheme();
  const selected = value ?? [0, 1, 2, 3, 4, 5, 6];
  return (
    <View>
      <Text style={{ color: t.secondary }}>{label}</Text>
      {days.map((day, index) => (
        <Pressable
          key={day}
          accessibilityRole="checkbox"
          accessibilityLabel={`${label}, ${day}`}
          accessibilityState={{ checked: selected.includes(index) }}
          onPress={() => {
            const next = selected.includes(index)
              ? selected.filter((v) => v !== index)
              : [...selected, index].sort();
            onChange(next.length === 7 ? undefined : next);
          }}
          style={{
            minHeight: 44,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <Text style={{ color: t.ink }}>{day}</Text>
          <Text style={{ color: t.information }}>{selected.includes(index) ? "✓" : ""}</Text>
        </Pressable>
      ))}
    </View>
  );
}
