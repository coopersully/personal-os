import type { SearchableWorkspace } from "@personal-os/domain";
import { router } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";
import { FilterChip } from "../../components/filter-chip";
import { Icon } from "../../components/icons";
import { RecordRow } from "../../components/record-row";
import { useTheme, workspaceColor } from "../../theme";
import { nameList as list, useWorkspaceSearch } from "./data";
import { searchDestination, searchResultIcon, searchResultPreview } from "./destinations";

/**
 * Header search results, grouped by workspace. Failures are reported by Sonner alone; this
 * surface only offers the retry and never claims "no matches" for a workspace it could not read.
 */
export function WorkspaceSearchResults({
  scope,
  query,
  onOpen,
}: {
  scope: readonly SearchableWorkspace[];
  query: string;
  onOpen: () => void;
}) {
  const t = useTheme();
  const [archiveOverride, setArchiveOverride] = useState<boolean | null>(null);
  const search = useWorkspaceSearch(scope, query, archiveOverride);
  const shown = search.groups.filter((group) => group.items.length);
  const failed = search.groups.filter((group) => group.status === "failed");
  const answered = search.groups.filter((group) => group.status === "ready");
  return (
    <View style={[styles.results, { backgroundColor: t.canvas, borderColor: t.line }]}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={styles.content}
      >
        <View style={styles.toolbar}>
          <FilterChip
            label="Include archive"
            icon="archive"
            selected={search.includeArchived}
            color={t.ink}
            onPress={() => setArchiveOverride(!search.includeArchived)}
          />
          {search.searching && <ActivityIndicator accessibilityLabel="Searching" color={t.ink} />}
        </View>
        {shown.map((group) => (
          <View key={group.workspace}>
            <Text accessibilityRole="header" style={[styles.heading, { color: t.secondary }]}>
              {group.workspace}
            </Text>
            {group.items.map((item) => (
              <RecordRow
                key={`${item.kind}:${item.id}`}
                title={item.title.trim() || `Untitled ${item.kind.toLowerCase()}`}
                subtitle={searchResultPreview(item.preview)}
                subtitleLines={2}
                {...(item.state ? { value: item.state } : {})}
                leading={
                  <Icon
                    name={searchResultIcon(group.workspace, item.kind)}
                    color={workspaceColor(t, group.workspace)}
                    size={21}
                  />
                }
                onPress={() => {
                  const destination = searchDestination(group.workspace, item);
                  onOpen();
                  if (destination.open === "push") router.push(destination.href);
                  else router.navigate(destination.href);
                }}
              />
            ))}
            {group.more && (
              <Text style={[styles.caption, { color: t.secondary }]}>
                Showing the first {group.items.length} in {group.workspace}. Keep typing to narrow.
              </Text>
            )}
          </View>
        ))}
        {!search.searching && !shown.length && answered.length > 0 && (
          <Text style={[styles.caption, { color: t.secondary }]}>
            No matches in {list(answered.map((group) => group.workspace))}.
          </Text>
        )}
        {!search.searching && failed.length > 0 && (
          <FilterChip
            label={`Search ${list(failed.map((group) => group.workspace))} again`}
            icon="refresh"
            selected={false}
            color={t.ink}
            onPress={() => void search.retry()}
          />
        )}
      </ScrollView>
    </View>
  );
}
const styles = StyleSheet.create({
  results: {
    position: "absolute",
    top: 60,
    left: 0,
    right: 0,
    maxHeight: 460,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  content: { padding: 14, gap: 4 },
  toolbar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  heading: { fontSize: 13, fontWeight: "600", paddingTop: 12 },
  caption: { fontSize: 13, paddingVertical: 8 },
});
