import { router } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Icon, type IconName } from "../../components/icons";
import { Screen } from "../../components/screen";
import { useTheme } from "../../theme";
import { usePreview } from "./context";
import { attentionItems, type BriefingItem, sampleItems } from "./sample";

export function BriefingRow({ item, last = false }: { item: BriefingItem; last?: boolean }) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${item.title}. ${item.summary}`}
      accessibilityHint="Opens details"
      onPress={() => router.push({ pathname: "/detail/[id]", params: { id: item.id } })}
      style={({ pressed }) => [
        styles.row,
        { borderBottomColor: last ? "transparent" : t.line, opacity: pressed ? 0.65 : 1 },
      ]}
    >
      <View style={[styles.mark, { backgroundColor: t[item.workspace] }]}>
        <Icon name={item.icon} color={t.white} />
      </View>
      <View style={styles.copy}>
        <Text style={[styles.rowTitle, { color: t.ink }]}>{item.title}</Text>
        <Text style={[styles.summary, { color: t.secondary }]}>{item.summary}</Text>
      </View>
      <Icon name="chevron" color={t.secondary} size={16} />
    </Pressable>
  );
}
function Section({
  title,
  label,
  icon,
  color,
  items,
}: {
  title: string;
  label: string;
  icon: IconName;
  color: string;
  items: BriefingItem[];
}) {
  const t = useTheme();
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <View style={styles.sectionName}>
          <Icon name={icon} color={color} size={18} />
          <Text accessibilityRole="header" style={[styles.sectionTitle, { color: t.ink }]}>
            {title}
          </Text>
        </View>
        <Text style={[styles.count, { color: t.secondary }]}>{label}</Text>
      </View>
      {items.length > 0 ? (
        <View style={[styles.group, { backgroundColor: t.surface }]}>
          {items.map((item, index) => (
            <BriefingRow key={item.id} item={item} last={index === items.length - 1} />
          ))}
        </View>
      ) : (
        <View style={styles.empty}>
          <Text style={[styles.rowTitle, { color: t.ink }]}>you’re all caught up.</Text>
          <Text style={[styles.summary, { color: t.secondary }]}>
            no decisions waiting in this sample day.
          </Text>
        </View>
      )}
    </View>
  );
}
export default function BriefingHome() {
  const t = useTheme();
  const { scenario } = usePreview();
  const attention = attentionItems(scenario);
  return (
    <Screen chrome>
      <View style={styles.intro}>
        <Text style={[styles.date, { color: t.secondary }]}>thursday, november 5</Text>
        <Text style={[styles.preview, { color: t.secondary, backgroundColor: t.surface }]}>
          sample day
        </Text>
      </View>
      <Text accessibilityRole="header" style={[styles.heading, { color: t.ink }]}>
        your day, at a glance.
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Sample monitoring status"
        onPress={() => router.push("/monitoring")}
        style={styles.monitoring}
      >
        <View
          style={[
            styles.dot,
            { backgroundColor: scenario === "interrupted" ? t.warning : t.success },
          ]}
        />
        <Text style={[styles.monitoringText, { color: t.secondary }]}>
          {scenario === "interrupted" ? "mail paused · see coverage" : "example checks · 9:39 am"}
        </Text>
        <Icon name="chevron" color={t.secondary} size={14} />
      </Pressable>
      <Section
        title="needs you"
        label={
          attention.length
            ? `${attention.length} ${attention.length === 1 ? "item" : "items"}`
            : "all clear"
        }
        icon="attention"
        color={t.warning}
        items={attention}
      />
      <Section
        title="coming up"
        label="sample · 10 am"
        icon="clock"
        color={t.information}
        items={sampleItems.filter((i) => i.id === "event")}
      />
      <Section
        title="handled for you"
        label="this sample morning"
        icon="check"
        color={t.success}
        items={sampleItems.filter((i) => ["receipts", "archive"].includes(i.id))}
      />
    </Screen>
  );
}
const styles = StyleSheet.create({
  intro: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  date: { fontSize: 12 },
  preview: { fontSize: 11, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  heading: { fontSize: 29, fontWeight: "600", letterSpacing: -1, marginBottom: 4 },
  monitoring: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: 7 },
  dot: { width: 5, height: 5, borderRadius: 3 },
  monitoringText: { fontSize: 12, flex: 1 },
  section: { marginTop: 20 },
  sectionHeader: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    gap: 8,
    alignItems: "center",
    marginBottom: 10,
  },
  sectionName: { flexDirection: "row", alignItems: "center", gap: 8 },
  sectionTitle: { fontSize: 15, fontWeight: "600" },
  count: { fontSize: 11 },
  group: { borderRadius: 14, paddingHorizontal: 12 },
  row: {
    flexDirection: "row",
    gap: 12,
    alignItems: "center",
    paddingVertical: 15,
    minHeight: 76,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  mark: { width: 34, height: 34, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  copy: { flex: 1 },
  rowTitle: { fontSize: 15, fontWeight: "500" },
  summary: { fontSize: 12, lineHeight: 18, marginTop: 4 },
  empty: { paddingVertical: 14 },
});
