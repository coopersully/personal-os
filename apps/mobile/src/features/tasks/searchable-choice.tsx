import { useState } from "react";
import {
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Icon } from "../../components/icons";
import { SheetHeader } from "../../components/sheet-header";
import { type EntityKind, entityDictionary } from "../../product/entities";
import { spacing, useTheme, workspaceColor } from "../../theme";
import { listTint } from "./list-presentation";
import { matchingOptions } from "./presentation";
import { type Option, SearchField, State, styles } from "./ui";

/** Shared searchable container selection. Cancel preserves the current value. */
export function SearchableChoice({
  label,
  entity,
  value,
  options,
  onChange,
  disabled = false,
}: {
  label: string;
  entity?: EntityKind;
  value: string;
  options: readonly Option[];
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const t = useTheme();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const close = () => {
    setOpen(false);
    setSearch("");
  };
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
        {entity && <Icon name={entityDictionary[entity].icon} size={22} color={t.secondary} />}
        <Text style={{ color: t.ink, fontSize: 17, flex: 1 }}>{label}</Text>
        <Text
          numberOfLines={1}
          style={{ color: workspaceColor(t, "tasks"), fontSize: 17, maxWidth: "55%" }}
        >
          {options.find((option) => option.value === value)?.label ?? "None"}
        </Text>
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
              data={matchingOptions(options, search)}
              keyExtractor={(option) => option.value}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              contentContainerStyle={{ paddingHorizontal: spacing.page, paddingBottom: spacing.xl }}
              ListEmptyComponent={<State empty="No matches. Try a different name." />}
              renderItem={({ item }) => (
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
                  <Text style={{ color: t.ink, fontSize: 17, flex: 1 }}>{item.label}</Text>
                  {item.value === value && (
                    <Icon name="save" size={22} color={workspaceColor(t, "tasks")} />
                  )}
                </Pressable>
              )}
            />
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>
    </>
  );
}
