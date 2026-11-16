import type { TaskList, TaskProject } from "@personal-os/domain";
import { FlatList, Pressable, Text, View } from "react-native";
import { Icon, type IconName } from "../../components/icons";
import { RowActions } from "../../components/row-actions";
import { entityDictionary } from "../../product/entities";
import { radius, spacing, touchTarget, useTheme, workspaceColor } from "../../theme";
import { finishedProjectLabel } from "./container-directory";
import { type TaskScope, useItemCounts } from "./navigation-counts";
import { formatTargetDate, itemCount } from "./presentation";
import { Action, groupEdges, styles } from "./ui";

type ContainerRowActions = {
  first: boolean;
  last: boolean;
  pinned: boolean;
  /** The list the row opens. The row reads its total, so only drawn rows ask for one. */
  scope: TaskScope;
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
  permanent = false,
  state,
  subtitleBelowActions = true,
  ...actions
}: ContainerRowActions & {
  /**
   * A long description reserves the action button's height so it can use the full width below
   * it. A short metadata line sits directly under the name instead and stays clear of the button.
   */
  subtitleBelowActions?: boolean;
  name: string;
  subtitle?: string;
  /** A status announced with the row, such as "Completed". */
  state?: string | null;
  icon: IconName;
  editable?: boolean;
  permanent?: boolean;
}) {
  const t = useTheme();
  const [count] = useItemCounts([actions.scope]);
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
        accessibilityLabel={`Open ${name}${state ? `, ${state.toLocaleLowerCase()}` : ""}`}
        accessibilityValue={count === undefined ? undefined : { text: itemCount(count) }}
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
          <View
            style={{
              flexDirection: "row",
              flexWrap: "wrap",
              alignItems: "flex-start",
              gap: spacing.sm,
              paddingRight: touchTarget + spacing.sm,
              minHeight: subtitleBelowActions ? touchTarget : undefined,
            }}
          >
            <Text style={{ color: t.ink, fontSize: 17 }}>{name}</Text>
            {permanent && <Text style={{ color: t.secondary, fontSize: 12 }}>Permanent</Text>}
            {count !== undefined && (
              <Text style={{ color: t.secondary, fontSize: 12 }}>{itemCount(count)}</Text>
            )}
          </View>
          {!!subtitle && (
            <Text
              numberOfLines={2}
              style={{
                color: t.secondary,
                fontSize: 12,
                paddingRight: subtitleBelowActions ? 0 : touchTarget + spacing.sm,
              }}
            >
              {subtitle}
            </Text>
          )}
        </View>
      </Pressable>
      <View style={{ position: "absolute", top: spacing.md, right: spacing.lg }}>
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
      permanent={record.kind === "inbox"}
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
      state={finishedProjectLabel(record)}
      subtitleBelowActions={false}
      subtitle={[
        finishedProjectLabel(record),
        listName,
        record.targetDate ? `Target ${formatTargetDate(record.targetDate)}` : null,
      ]
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
  scopeOf,
  loading = false,
  onRetry,
  onPin,
  onEdit,
  disabled = false,
}: {
  items: Array<TaskList | TaskProject>;
  kind: "list" | "project";
  onOpen: (record: TaskList | TaskProject) => void;
  /** The list each card opens, and so counts. */
  scopeOf: (record: TaskList | TaskProject) => TaskScope;
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
            <PinnedCard
              item={item}
              kind={kind}
              scope={scopeOf(item)}
              disabled={disabled}
              onOpen={onOpen}
              onPin={onPin}
              onEdit={onEdit}
            />
          )}
        />
      )}
    </View>
  );
}
/** A pinned card reads its own count, so only the cards the row has drawn ask for one. */
function PinnedCard({
  item,
  kind,
  scope,
  disabled,
  onOpen,
  onPin,
  onEdit,
}: {
  item: TaskList | TaskProject;
  kind: "list" | "project";
  scope: TaskScope;
  disabled: boolean;
  onOpen: (record: TaskList | TaskProject) => void;
  onPin: (record: TaskList | TaskProject) => void;
  onEdit: (record: TaskList | TaskProject) => void;
}) {
  const t = useTheme();
  const state = "lifecycle" in item ? finishedProjectLabel(item) : null;
  const [count] = useItemCounts([scope]);
  return (
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
        <Icon name={entityDictionary[kind].icon} color={workspaceColor(t, "tasks")} size={22} />
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
        accessibilityLabel={`Open pinned ${kind}: ${item.name}${state ? `, ${state.toLocaleLowerCase()}` : ""}`}
        accessibilityValue={count === undefined ? undefined : { text: itemCount(count) }}
        onPress={() => onOpen(item)}
        style={{ minHeight: touchTarget, justifyContent: "center" }}
      >
        <Text numberOfLines={2} style={{ fontSize: 16, fontWeight: "600", color: t.ink }}>
          {item.name}
        </Text>
        {"kind" in item && item.kind === "inbox" && (
          <Text style={{ color: t.secondary, fontSize: 12 }}>Permanent</Text>
        )}
        {state && <Text style={{ color: t.secondary, fontSize: 12 }}>{state}</Text>}
        {count !== undefined && (
          <Text style={{ color: t.secondary, fontSize: 12 }}>{itemCount(count)}</Text>
        )}
      </Pressable>
    </View>
  );
}
