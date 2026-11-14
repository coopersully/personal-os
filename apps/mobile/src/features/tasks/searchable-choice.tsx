import { useState } from "react";
import {
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Icon, type IconName } from "../../components/icons";
import { useSettingsAccent } from "../../components/settings-accent";
import { SettingLabel, SettingValue } from "../../components/settings-row-content";
import { SheetHeader } from "../../components/sheet-header";
import { type EntityKind, entityDictionary } from "../../product/entities";
import { spacing, useTheme } from "../../theme";
import { listTint } from "./list-presentation";
import { matchingOptions } from "./presentation";
import { groupEdges, type Option, SearchField, State, styles } from "./ui";

/** Shared searchable container selection. Cancel preserves the current value. */
export function SearchableChoice({
  label,
  entity,
  icon,
  value,
  options,
  onChange,
  disabled = false,
}: {
  label: string;
  entity?: EntityKind;
  icon?: IconName;
  value: string;
  options: readonly Option[];
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const t = useTheme();
  const accent = useSettingsAccent();
  const leadingIcon = entity ? entityDictionary[entity].icon : icon;
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const close = () => {
    setOpen(false);
    setSearch("");
  };
  const matches = matchingOptions(options, search);
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}, ${options.find((option) => option.value === value)?.label ?? "None"}`}
        accessibilityState={{ disabled, expanded: open }}
        disabled={disabled}
        onPress={() => setOpen(true)}
        style={({ pressed }) => [
          styles.settingRow,
          { alignItems: "center", opacity: disabled ? 0.4 : pressed ? 0.6 : 1 },
        ]}
      >
        {leadingIcon && <Icon name={leadingIcon} size={22} color={t.secondary} />}
        <SettingLabel>{label}</SettingLabel>
        <SettingValue style={{ color: accent }}>
          {options.find((option) => option.value === value)?.label ?? "None"}
        </SettingValue>
        <Icon name="chevron" size={16} color={t.secondary} />
      </Pressable>
      <Modal
        visible={open}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={close}
      >
        <SafeAreaView edges={["top", "bottom"]} style={{ flex: 1, backgroundColor: t.canvas }}>
          <KeyboardAvoidingView
            style={{ flex: 1 }}
            behavior={Platform.OS === "ios" ? "padding" : undefined}
          >
            <SheetHeader title={label} label="Cancel" onClose={close} />
            <View style={{ paddingHorizontal: spacing.page }}>
              <SearchField
                accessibilityLabel={`Search ${label.toLowerCase()}`}
                placeholder="Home"
                value={search}
                onChangeText={setSearch}
              />
            </View>
            <FlatList
              data={matches}
              keyExtractor={(option) => option.value}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              contentContainerStyle={{ paddingHorizontal: spacing.page, paddingBottom: spacing.xl }}
              ListEmptyComponent={<State empty="No matches. Try a different name." />}
              renderItem={({ item, index }) => (
                // The list stays virtualized; each row draws its share of one rounded group.
                <View
                  testID="choice-group-row"
                  style={[
                    { backgroundColor: t.surface },
                    groupEdges(index === 0, index === matches.length - 1),
                  ]}
                >
                  {index > 0 && (
                    <View
                      style={{
                        height: StyleSheet.hairlineWidth,
                        backgroundColor: t.line,
                        marginLeft: spacing.lg,
                      }}
                    />
                  )}
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ selected: item.value === value }}
                    onPress={() => {
                      onChange(item.value);
                      close();
                    }}
                    style={({ pressed }) => [styles.settingRow, { opacity: pressed ? 0.6 : 1 }]}
                  >
                    {entity && item.label !== "None" && (
                      <Icon
                        name={item.icon ?? entityDictionary[entity].icon}
                        color={listTint(item.color, t.dark, t.secondary)}
                        size={22}
                      />
                    )}
                    <SettingLabel>{item.label}</SettingLabel>
                    {item.value === value && <Icon name="save" size={22} color={accent} />}
                  </Pressable>
                </View>
              )}
            />
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>
    </>
  );
}
