import type { HomeLocation } from "@personal-os/domain";
import { useEffect, useState } from "react";
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
import { useTheme } from "../../theme";
import { Action, SearchField, State, styles } from "../tasks/ui";
import { useSettingsResource } from "./data";
export function ProfileLocation({
  value,
  onChange,
}: {
  value: HomeLocation | null;
  onChange: (location: HomeLocation | null) => void;
}) {
  const t = useTheme();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);
  const locations = useSettingsResource(
    `locations:${query}`,
    (api) => api.searchWeatherLocations(query),
    open && query.length >= 2,
  );
  const close = () => {
    setOpen(false);
    setSearch("");
    setQuery("");
  };
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Home location, ${value?.label ?? "Not set"}`}
        onPress={() => setOpen(true)}
        style={styles.settingRow}
      >
        <Icon name="location" color={t.secondary} size={22} />
        <Text style={{ color: t.ink, fontSize: 17, flex: 1 }}>Home location</Text>
        <Text numberOfLines={1} style={{ color: t.secondary, fontSize: 17, maxWidth: "55%" }}>
          {value?.label ?? "Not set"}
        </Text>
        <Icon name="chevron" color={t.secondary} size={16} />
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
            <SheetHeader title="Home location" label="Cancel" onClose={close} />
            <View style={{ paddingHorizontal: 20 }}>
              <SearchField
                accessibilityLabel="Search locations"
                placeholder="Chicago"
                value={search}
                onChangeText={setSearch}
              />
              <Action
                label="Clear home location"
                onPress={() => {
                  onChange(null);
                  close();
                }}
              />
            </View>
            <FlatList
              data={query === search.trim() && query.length >= 2 ? (locations.data ?? []) : []}
              keyboardShouldPersistTaps="handled"
              keyExtractor={(item) =>
                `${item.label}:${item.coordinates.latitude}:${item.coordinates.longitude}`
              }
              ListEmptyComponent={
                <State
                  loading={query.length >= 2 && locations.isFetching}
                  retry={locations.isError ? () => void locations.refetch() : undefined}
                  empty={query.length < 2 ? "Search a city or place." : "No locations found."}
                />
              }
              renderItem={({ item }) => (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => {
                    onChange(item);
                    close();
                  }}
                  style={styles.settingRow}
                >
                  <Text style={{ color: t.ink, fontSize: 17 }}>{item.label}</Text>
                </Pressable>
              )}
            />
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>
    </>
  );
}
