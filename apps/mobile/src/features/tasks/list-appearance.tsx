import type { TaskListIcon } from "@personal-os/domain";
import { useState } from "react";
import { Modal, Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Icon, type IconName } from "../../components/icons";
import { useTheme } from "../../theme";
import { Action, Field, FormBody, Section, styles } from "./ui";
export const listIcons: Record<TaskListIcon, IconName> = {
  list: "views",
  home: "home",
  star: "star",
  target: "target",
  calendar: "calendar",
  wallet: "wallet",
  people: "people",
  receipt: "receipt",
};
const colors = [
  "",
  "#a78bfa",
  "#ef4444",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#06b6d4",
  "#3b82f6",
  "#ec4899",
];
export function ListAppearance({
  icon,
  color,
  onChange,
}: {
  icon: TaskListIcon;
  color: string;
  onChange: (icon: TaskListIcon, color: string) => void;
}) {
  const t = useTheme();
  const [open, setOpen] = useState(false);
  const [draftIcon, setIcon] = useState(icon);
  const [draftColor, setColor] = useState(color);
  const valid = draftColor === color || !draftColor || /^#[0-9a-f]{6}$/i.test(draftColor);
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Edit list icon and color"
        onPress={() => {
          setIcon(icon);
          setColor(color);
          setOpen(true);
        }}
        style={{
          width: 44,
          minHeight: 56,
          alignItems: "center",
          justifyContent: "flex-start",
          paddingTop: 4,
        }}
      >
        <Icon name={listIcons[icon]} color={color || t.ink} size={28} />
      </Pressable>
      <Modal
        visible={open}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setOpen(false)}
      >
        <SafeAreaView style={{ flex: 1, backgroundColor: t.canvas }}>
          <View style={[styles.settingRow, { justifyContent: "space-between" }]}>
            <Action label="Cancel" onPress={() => setOpen(false)} />
            <Text style={{ color: t.ink, fontSize: 18, fontWeight: "600" }}>Appearance</Text>
            <Action
              label="Done"
              disabled={!valid}
              onPress={() => {
                onChange(draftIcon, draftColor);
                setOpen(false);
              }}
            />
          </View>
          <FormBody>
            <Section title="Icon">
              <View style={{ flexDirection: "row", flexWrap: "wrap", padding: 16, gap: 8 }}>
                {(Object.keys(listIcons) as TaskListIcon[]).map((item) => (
                  <Pressable
                    key={item}
                    accessibilityRole="button"
                    accessibilityLabel={`${item} icon`}
                    accessibilityState={{ selected: item === draftIcon }}
                    onPress={() => setIcon(item)}
                    style={{
                      width: 56,
                      height: 56,
                      borderRadius: 12,
                      alignItems: "center",
                      justifyContent: "center",
                      backgroundColor: item === draftIcon ? t.canvas : "transparent",
                    }}
                  >
                    <Icon
                      name={listIcons[item]}
                      color={valid && draftColor ? draftColor : t.ink}
                      size={28}
                    />
                  </Pressable>
                ))}
              </View>
            </Section>
            <Section title="Color">
              <View style={{ flexDirection: "row", flexWrap: "wrap", padding: 16, gap: 8 }}>
                {colors.map((item) => (
                  <Pressable
                    key={item}
                    accessibilityRole="button"
                    accessibilityLabel={item || "Default color"}
                    accessibilityState={{ selected: item === draftColor }}
                    onPress={() => setColor(item)}
                    style={{
                      width: 48,
                      height: 48,
                      borderRadius: 24,
                      alignItems: "center",
                      justifyContent: "center",
                      backgroundColor: item || t.canvas,
                    }}
                  >
                    {item === draftColor && <Icon name="check" color={item ? "#000000" : t.ink} />}
                  </Pressable>
                ))}
              </View>
              <Field
                label="Custom color (hex)"
                value={draftColor}
                onChangeText={setColor}
                autoCapitalize="none"
                maxLength={7}
                placeholder="#7928ff"
              />
            </Section>
          </FormBody>
        </SafeAreaView>
      </Modal>
    </>
  );
}
