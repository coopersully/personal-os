import Constants from "expo-constants";
import { router } from "expo-router";
import { useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { useTheme } from "../../theme";
import {
  type SettingsDestinationId,
  searchSettings,
  settingsGroups,
  settingsPath,
} from "./navigation";
import { SettingsRow } from "./settings-row";
import { settingsScreens } from "./settings-screen";
import { SettingsSearch } from "./settings-search";
export function SettingsHome() {
  const t = useTheme();
  const [query, setQuery] = useState("");
  const destinations = searchSettings(
    query,
    Object.keys(settingsScreens) as SettingsDestinationId[],
  );
  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      contentInsetAdjustmentBehavior="automatic"
      style={{ flex: 1, backgroundColor: t.canvas }}
      contentContainerStyle={{ padding: 20, paddingBottom: 40, gap: 24 }}
    >
      <SettingsSearch value={query} onChangeText={setQuery} />
      {settingsGroups.map((group) => {
        const rows = destinations.filter((destination) => destination.group === group);
        return rows.length ? (
          <View key={group} style={{ gap: 8 }}>
            <Text
              accessibilityRole="header"
              style={{ color: t.secondary, fontSize: 14, paddingHorizontal: 16 }}
            >
              {group}
            </Text>
            <View style={{ backgroundColor: t.surface, borderRadius: 16, overflow: "hidden" }}>
              {rows.map((destination, index) => (
                <View key={destination.id}>
                  {index > 0 && (
                    <View style={{ height: 0.5, marginLeft: 50, backgroundColor: t.line }} />
                  )}
                  <SettingsRow
                    label={destination.label}
                    icon={destination.icon}
                    onPress={() => router.push(settingsPath(destination.id))}
                  />
                </View>
              ))}
            </View>
          </View>
        ) : null;
      })}
      <Text selectable style={{ color: t.secondary, textAlign: "center", fontSize: 13 }}>
        nohmi {Constants.nativeAppVersion ?? Constants.expoConfig?.version ?? "Development"} · Build{" "}
        {Constants.nativeBuildVersion ?? Constants.expoConfig?.ios?.buildNumber ?? "Development"}
      </Text>
      {destinations.length === 0 && (
        <Text style={{ color: t.secondary, textAlign: "center" }}>No settings found</Text>
      )}
    </ScrollView>
  );
}
