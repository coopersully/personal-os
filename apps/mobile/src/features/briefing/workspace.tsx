import { StyleSheet, Text, View } from "react-native";
import { Icon } from "../../components/icons";
import { Screen } from "../../components/screen";
import { useTheme } from "../../theme";
import { BriefingRow } from "./home";
import { sampleItems } from "./sample";

export function WorkspacePreview({
  workspace,
}: {
  workspace: "mail" | "tasks" | "calendar" | "finances";
}) {
  const t = useTheme();
  const items = sampleItems.filter(
    (item) => item.workspace === workspace && item.id !== "connection",
  );
  return (
    <Screen chrome>
      <View style={styles.heading}>
        <View style={[styles.mark, { backgroundColor: t[workspace] }]}>
          <Icon name={workspace} color={t.white} size={24} />
        </View>
        <Text accessibilityRole="header" style={[styles.title, { color: t.ink }]}>
          {workspace}
        </Text>
      </View>
      <Text style={[styles.description, { color: t.secondary }]}>
        sample workspace · your accounts are not connected
      </Text>
      {items.length ? (
        <View style={[styles.group, { backgroundColor: t.surface }]}>
          {items.map((item, index) => (
            <BriefingRow key={item.id} item={item} last={index === items.length - 1} />
          ))}
        </View>
      ) : (
        <Text style={[styles.description, { color: t.secondary }]}>
          Your financial overview will arrive in a later build. No financial data is loaded in this
          preview.
        </Text>
      )}
    </Screen>
  );
}
const styles = StyleSheet.create({
  heading: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 8 },
  mark: { width: 42, height: 42, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 28, fontWeight: "600" },
  description: { fontSize: 14, lineHeight: 22, marginVertical: 20 },
  group: { borderRadius: 14, paddingHorizontal: 12 },
});
