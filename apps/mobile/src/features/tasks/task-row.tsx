import type { TaskWorkspaceItem } from "@personal-os/domain";
import { Pressable, Text, View } from "react-native";
import { Icon } from "../../components/icons";
import { spacing, useTheme, workspaceColor } from "../../theme";
import { useAuth } from "../auth/context";
import { isPastDue } from "./due-date";
import { isOpen } from "./logic";
import { taskMetadata } from "./presentation";
import { groupEdges, styles } from "./ui";
export function TaskRow({
  item,
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
  const metadata = taskMetadata(item, state.user?.planningTimezone);
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
      </Pressable>
    </View>
  );
}
