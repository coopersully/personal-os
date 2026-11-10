import { useRef, useState } from "react";
import { Modal, Pressable, ScrollView, Text, View } from "react-native";
import { Icon } from "../../components/icons";
import { SettingLabel, SettingValue } from "../../components/settings-row-content";
import { SheetHeader } from "../../components/sheet-header";
import { useTheme } from "../../theme";

const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export function DaySelection({
  label,
  value,
  onChange,
  disabled = false,
}: {
  label: string;
  value: number[] | undefined;
  onChange: (value: number[] | undefined) => void;
  disabled?: boolean;
}) {
  const disabledRef = useRef(disabled);
  disabledRef.current = disabled;
  const t = useTheme();
  const [expanded, setExpanded] = useState(false);
  const selected = value ?? [0, 1, 2, 3, 4, 5, 6];
  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}, ${selected.length === 7 ? "Every day" : selected.length === 0 ? "Choose days" : selected.map((day) => days[day]?.slice(0, 3)).join(", ")}`}
        disabled={disabled}
        accessibilityState={{ expanded, disabled }}
        onPress={() => {
          if (!disabledRef.current) setExpanded(!expanded);
        }}
        style={{ minHeight: 56, padding: 16, flexDirection: "row", alignItems: "center", gap: 12 }}
      >
        <SettingLabel>{label}</SettingLabel>
        <SettingValue>
          {selected.length === 7
            ? "Every day"
            : selected.length === 0
              ? "Choose days"
              : selected.map((day) => days[day]?.slice(0, 3)).join(", ")}
        </SettingValue>
        <Icon name="chevron" color={t.secondary} size={16} />
      </Pressable>
      <Modal
        visible={expanded}
        presentationStyle="formSheet"
        animationType="slide"
        onRequestClose={() => setExpanded(false)}
      >
        <View accessibilityViewIsModal style={{ flex: 1, backgroundColor: t.canvas, padding: 20 }}>
          <SheetHeader
            title={label}
            label="Done"
            onClose={() => setExpanded(false)}
            inset={false}
          />
          <ScrollView style={{ maxHeight: 420 }} contentContainerStyle={{ paddingBottom: 20 }}>
            {days.map((day, index) => (
              <Pressable
                key={day}
                accessibilityRole="checkbox"
                accessibilityLabel={`${label}, ${day}`}
                disabled={disabled}
                accessibilityState={{ checked: selected.includes(index), disabled }}
                onPress={() => {
                  if (disabledRef.current) return;
                  const next = selected.includes(index)
                    ? selected.filter((v) => v !== index)
                    : [...selected, index].sort();
                  onChange(next.length === 7 ? undefined : next);
                }}
                style={{
                  minHeight: 44,
                  paddingHorizontal: 16,
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <Text style={{ color: t.ink }}>{day}</Text>
                <Text style={{ color: t.ink }}>{selected.includes(index) ? "✓" : ""}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}
