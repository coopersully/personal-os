import { useState } from "react";
import { Modal, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { radius, spacing, useTheme } from "../../theme";
import { Icon, type IconName } from "../icons";

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
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <Text
            accessibilityRole="header"
            style={{ flex: 1, color: t.ink, fontSize: 24, fontWeight: "600" }}
          >
            {title}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close picker"
            onPress={onClose}
            style={{ minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center" }}
          >
            <Icon name="cancel" color={t.ink} />
          </Pressable>
        </View>
        <TextInput
          accessibilityLabel={`Search ${title.toLowerCase()}`}
          value={search}
          onChangeText={setSearch}
          placeholder={`Search ${title.toLowerCase()}`}
          placeholderTextColor={t.secondary}
          style={{
            color: t.ink,
            fontSize: 17,
            padding: 16,
            minHeight: 48,
            backgroundColor: t.surface,
            borderRadius: radius.menu,
            marginVertical: 16,
          }}
        />
        <ScrollView
          automaticallyAdjustKeyboardInsets
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
        >
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
              style={{
                minHeight: 56,
                flexDirection: "row",
                alignItems: "center",
                gap: 12,
                paddingVertical: 12,
              }}
            >
              <Icon name={option.icon ?? icon} color={t.secondary} />
              <Text style={{ flex: 1, color: t.ink, fontSize: 17 }}>{option.label}</Text>
              {value === option.value && <Icon name="save" color={t.ink} />}
            </Pressable>
          ))}
          {matches.length === 0 && (
            <Text style={{ color: t.secondary, fontSize: 16, paddingVertical: 16 }}>
              No matching {title.toLowerCase()}.
            </Text>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}
