import { useState } from "react";
import { Modal, Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { spacing, useTheme } from "../../theme";
import { Icon, type IconName } from "../icons";
import { SettingLabel } from "../settings-row-content";
import { SheetHeader } from "../sheet-header";
import { formRow } from "./form-row";
import { Group, SearchField, SectionNote } from "./form-rows";

/** Large entity choices use a searchable sheet with leading identities and trailing selection. */
export function EntityPicker({
  title,
  icon,
  value,
  options,
  onChange,
  onClose,
}: {
  title: string;
  icon: IconName;
  value: string | null;
  options: { label: string; value: string | null; icon?: IconName }[];
  onChange: (value: string | null) => void;
  onClose: () => void;
}) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const [search, setSearch] = useState("");
  const matches = options.filter((option) =>
    option.label.toLowerCase().includes(search.trim().toLowerCase()),
  );
  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View
        style={{
          flex: 1,
          backgroundColor: t.canvas,
          paddingTop: 20,
          paddingHorizontal: spacing.page,
          paddingBottom: Math.max(insets.bottom, 20),
        }}
      >
        <SheetHeader title={title} onClose={onClose} inset={false} />
        <SearchField
          accessibilityLabel={`Search ${title.toLowerCase()}`}
          value={search}
          onChangeText={setSearch}
          placeholder={`Search ${title.toLowerCase()}`}
          style={{ marginTop: spacing.md }}
        />
        <ScrollView
          automaticallyAdjustKeyboardInsets
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
        >
          <Group>
            {matches.map((option) => (
              <Pressable
                key={option.value ?? "none"}
                accessibilityRole="radio"
                accessibilityLabel={option.label}
                accessibilityState={{ checked: value === option.value }}
                onPress={() => {
                  onChange(option.value);
                  onClose();
                }}
                style={({ pressed }) => [formRow, { opacity: pressed ? 0.6 : 1 }]}
              >
                <Icon name={option.icon ?? icon} color={t.secondary} size={22} />
                <SettingLabel>{option.label}</SettingLabel>
                {value === option.value && <Icon name="save" color={t.ink} size={22} />}
              </Pressable>
            ))}
            {matches.length === 0 && <SectionNote>No matching {title.toLowerCase()}.</SectionNote>}
          </Group>
        </ScrollView>
      </View>
    </Modal>
  );
}
