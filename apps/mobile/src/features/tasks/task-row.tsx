import type { TaskWorkspaceItem } from "@personal-os/domain";
import { Pressable, Text, View } from "react-native";
import { Icon } from "../../components/icons";
import { spacing, useTheme, workspaceColor } from "../../theme";
import { useAuth } from "../auth/context";
import { isPastDue } from "./due-date";
import { isOpen } from "./logic";
import {
  type TaskRowDetail,
  taskMetadata,
  taskRowDetails,
  taskRowSummary,
  visibleRowTags,
} from "./presentation";
import { groupEdges, styles } from "./ui";
export function TaskRow({
  item,
  details,
  list,
  project,
  marked,
  selecting,
  pending,
  first,
  last,
  onSelect,
  onComplete,
  onOpen,
}: {
  item: TaskWorkspaceItem;
  /** The saved row-detail preference; nothing optional shows until it has loaded. */
  details?: readonly TaskRowDetail[];
  /** Names of the owning List and Project, left out where the screen already names them. */
  list?: string;
  project?: string;
  marked: boolean;
  selecting: boolean;
  pending: boolean;
  first: boolean;
  last: boolean;
  onSelect: () => void;
  onComplete: () => void;
  onOpen: () => void;
}) {
  const t = useTheme();
  const done = !isOpen(item);
  const overdue = !done && !item.deletedAt && isPastDue(item.record.dueAt);
  const { state } = useAuth();
  const timezone = state.user?.planningTimezone;
  const metadata = taskMetadata(item, timezone);
  const shown = taskRowDetails(item, { details, timezone, list, project });
  const summary = taskRowSummary(metadata, shown, overdue);
  const hiddenTags = shown.tags.length - visibleRowTags;
  return (
    <View
      style={[
        styles.row,
        { alignItems: "flex-start", paddingVertical: spacing.lg, gap: spacing.xs },
        groupEdges(first, last),
        {
          backgroundColor: marked
            ? `${workspaceColor(t, "tasks")}22`
            : overdue
              ? `${t.destructive}0D`
              : t.surface,
          borderBottomColor: t.line,
          borderBottomWidth: last ? 0 : 0.5,
        },
      ]}
    >
      <Pressable
        accessibilityRole="checkbox"
        accessibilityLabel={`${selecting ? "Select" : done ? "Reopen" : "Complete"} ${item.record.title}`}
        accessibilityState={{
          checked: selecting ? marked : done,
          disabled: pending || (!selecting && (item.readOnly || !!item.deletedAt)),
        }}
        hitSlop={{ left: 8 }}
        disabled={pending || (!selecting && (item.readOnly || !!item.deletedAt))}
        onPress={() => (selecting ? onSelect() : onComplete())}
        style={{
          minWidth: 36,
          minHeight: 44,
          justifyContent: "flex-start",
          alignItems: "flex-start",
        }}
      >
        <View
          style={{
            width: 25,
            height: 25,
            borderRadius: 13,
            borderWidth: 1.5,
            borderColor: done || marked ? workspaceColor(t, "tasks") : t.secondary,
            backgroundColor: done || marked ? workspaceColor(t, "tasks") : "transparent",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {(done || marked) && <Icon name="save" size={19} color={t.canvas} />}
        </View>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Open ${item.kind}: ${item.record.title}`}
        accessibilityValue={summary ? { text: summary } : undefined}
        onPress={() => (selecting ? onSelect() : onOpen())}
        onLongPress={onSelect}
        style={{
          flex: 1,
          minWidth: 0,
          minHeight: 44,
          justifyContent: "flex-start",
          gap: spacing.xs,
        }}
      >
        <Text
          style={{
            color: t.ink,
            fontSize: 17,
            textDecorationLine: done ? "line-through" : "none",
          }}
        >
          {item.record.title}
        </Text>
        {metadata.length > 0 && (
          <Text numberOfLines={1} style={{ color: t.secondary, fontSize: 12 }}>
            {metadata.map((part, index) => (
              <Text
                key={part}
                style={
                  part.startsWith("Due ") && overdue
                    ? { color: t.destructive, fontWeight: "600" }
                    : undefined
                }
              >
                {index > 0 ? " · " : ""}
                {part.startsWith("Due ") && overdue ? part.replace("Due ", "Overdue · ") : part}
              </Text>
            ))}
          </Text>
        )}
        {shown.context.length > 0 && (
          <Text numberOfLines={1} style={{ color: t.secondary, fontSize: 12 }}>
            {shown.context.join(" · ")}
          </Text>
        )}
        {shown.notes && (
          <Text numberOfLines={2} style={{ color: t.secondary, fontSize: 13 }}>
            {shown.notes}
          </Text>
        )}
        {shown.tags.length > 0 && (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.xs }}>
            {[
              ...shown.tags.slice(0, visibleRowTags).map((tag) => ({ key: `tag:${tag}`, tag })),
              ...(hiddenTags > 0 ? [{ key: "more", tag: `+${hiddenTags} more` }] : []),
            ].map(({ key, tag }) => (
              <View
                key={key}
                style={{
                  maxWidth: "100%",
                  borderRadius: 10,
                  paddingHorizontal: spacing.sm,
                  paddingVertical: 2,
                  backgroundColor: t.canvas,
                }}
              >
                <Text numberOfLines={1} style={{ color: t.secondary, fontSize: 12 }}>
                  {tag}
                </Text>
              </View>
            ))}
          </View>
        )}
      </Pressable>
    </View>
  );
}
