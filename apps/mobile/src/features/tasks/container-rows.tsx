import type { TaskList, TaskProject } from "@personal-os/domain";
import { FlatList, Pressable, Text, View } from "react-native";
import { Icon, type IconName } from "../../components/icons";
import { RowActions } from "../../components/row-actions";
import { entityDictionary } from "../../product/entities";
import { radius, spacing, touchTarget, useTheme, workspaceColor } from "../../theme";
import { Action, groupEdges, styles } from "./ui";

type ContainerRowActions = {
  first: boolean;
  last: boolean;
  pinned: boolean;
  disabled: boolean;
  onOpen: () => void;
  onPin: () => void;
  onEdit: () => void;
};
function ContainerRow({
  name,
  subtitle,
  icon,
  editable = true,
  ...actions
}: ContainerRowActions & { name: string; subtitle?: string; icon: IconName; editable?: boolean }) {
  const t = useTheme();
  return (
    <View
      style={[
        styles.row,
        groupEdges(actions.first, actions.last),
        { backgroundColor: t.surface, alignItems: "flex-start" },
      ]}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Open ${name}`}
        onPress={actions.onOpen}
        style={{
          flex: 1,
          flexDirection: "row",
          gap: spacing.md,
          minHeight: touchTarget,
          alignItems: "flex-start",
        }}
      >
        <Icon name={icon} size={24} color={t.secondary} />
        <View style={{ flex: 1, gap: spacing.xs }}>
          <Text style={{ color: t.ink, fontSize: 17 }}>{name}</Text>
          {!!subtitle && (
            <Text numberOfLines={2} style={{ color: t.secondary, fontSize: 12 }}>
              {subtitle}
            </Text>
          )}
        </View>
      </Pressable>
      <RowActions
        label={`Actions for ${name}`}
        actions={[
          {
            id: "pin",
            label: `${actions.pinned ? "Unpin" : "Pin"} ${name}`,
            icon: "pin",
            onPress: actions.onPin,
            disabled: actions.disabled,
          },
          ...(editable
            ? [
                {
                  id: "edit",
                  label: `Edit ${name}`,
                  icon: "settings" as const,
                  onPress: actions.onEdit,
                },
              ]
            : []),
        ]}
      />
    </View>
  );
}
export function ListRow({ record, ...actions }: ContainerRowActions & { record: TaskList }) {
  return (
    <ContainerRow
      {...actions}
      name={record.name}
      subtitle={record.description ?? undefined}
      icon={entityDictionary.list.icon}
      editable={record.kind !== "inbox"}
    />
  );
}
export function ProjectRow({
  record,
  listName,
  ...actions
}: ContainerRowActions & { record: TaskProject; listName?: string }) {
  return (
    <ContainerRow
      {...actions}
      name={record.name}
      subtitle={[listName, record.targetDate ? `Target ${record.targetDate}` : null]
        .filter(Boolean)
        .join(" · ")}
      icon={entityDictionary.project.icon}
    />
  );
}
export function PinnedContainers({
  items,
  kind,
  onOpen,
  loading = false,
  onRetry,
  onPin,
  onEdit,
  disabled = false,
}: {
  items: Array<TaskList | TaskProject>;
  kind: "list" | "project";
  onOpen: (record: TaskList | TaskProject) => void;
  loading?: boolean;
  onRetry?: () => void;
  onPin: (record: TaskList | TaskProject) => void;
  onEdit: (record: TaskList | TaskProject) => void;
  disabled?: boolean;
}) {
  const t = useTheme();
  if (!items.length && !onRetry) return null;
  return (
    <View style={{ marginBottom: spacing.xl, gap: spacing.sm }}>
      <Text accessibilityRole="header" style={{ fontSize: 13, color: t.secondary }}>
        Pinned {kind === "list" ? "lists" : "projects"}
      </Text>
      {onRetry ? (
        <Action label="Retry pins" onPress={onRetry} />
      ) : loading ? (
        <Text style={{ color: t.secondary }}>Loading pins…</Text>
      ) : (
        <FlatList
          horizontal
          data={items}
          keyExtractor={(item) => item.id}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: spacing.md }}
          renderItem={({ item }) => (
            <View
              style={{
                width: 180,
                minHeight: 96,
                padding: spacing.lg,
                gap: spacing.sm,
                borderRadius: radius.panel,
                backgroundColor: t.surface,
              }}
            >
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "flex-start",
                  justifyContent: "space-between",
                }}
              >
                <Icon
                  name={entityDictionary[kind].icon}
                  color={workspaceColor(t, "tasks")}
                  size={22}
                />
                <RowActions
                  label={`Actions for ${item.name}`}
                  actions={[
                    {
                      id: "unpin",
                      label: `Unpin ${item.name}`,
                      icon: "pin",
                      onPress: () => onPin(item),
                      disabled,
                    },
                    ...("kind" in item && item.kind === "inbox"
                      ? []
                      : [
                          {
                            id: "edit",
                            label: `Edit ${item.name}`,
                            icon: "settings" as const,
                            onPress: () => onEdit(item),
                          },
                        ]),
                  ]}
                />
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Open pinned ${kind}: ${item.name}`}
                onPress={() => onOpen(item)}
                style={{ minHeight: touchTarget, justifyContent: "center" }}
              >
                <Text numberOfLines={2} style={{ fontSize: 16, fontWeight: "600", color: t.ink }}>
                  {item.name}
                </Text>
              </Pressable>
            </View>
          )}
        />
      )}
    </View>
  );
}
