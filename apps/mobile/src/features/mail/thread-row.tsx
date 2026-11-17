import type { MailThreadSummary } from "@personal-os/domain";
import { Pressable, Text, View } from "react-native";
import { Icon } from "../../components/icons";
import type { RowAction } from "../../components/row-action-button";
import { RowActions } from "../../components/row-actions";
import { spacing, useTheme } from "../../theme";
import { messageTime, senderName } from "./logic";

/**
 * One conversation: sender, time, subject and preview, with unread carried by dot and weight.
 * Its actions sit beside the row, not inside it, so they never open the conversation.
 */
export function ThreadRow({
  thread,
  actions,
  onOpen,
}: {
  thread: MailThreadSummary;
  actions: readonly RowAction[];
  onOpen: () => void;
}) {
  const t = useTheme();
  const sender = senderName(thread.from);
  const subject = thread.subject || "No subject";
  return (
    <View
      style={{
        backgroundColor: t.canvas,
        flexDirection: "row",
        paddingVertical: spacing.lg,
        paddingRight: spacing.page,
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={[
          thread.unread ? "Unread" : "",
          thread.starred ? "Starred" : "",
          sender,
          subject,
          thread.snippet,
          messageTime(thread.receivedAt),
          thread.messageCount > 1 ? `${thread.messageCount} messages` : "",
        ]
          .filter(Boolean)
          .join(". ")}
        accessibilityHint="Opens the conversation."
        onPress={onOpen}
        style={{ flex: 1, minWidth: 0, flexDirection: "row" }}
      >
        <View style={{ width: 28, alignItems: "center", paddingTop: 7 }}>
          {thread.unread && (
            <View
              style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: t.information }}
            />
          )}
        </View>
        <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
          <View style={{ flexDirection: "row", gap: spacing.sm, alignItems: "baseline" }}>
            <Text
              numberOfLines={1}
              style={{
                color: t.ink,
                flex: 1,
                fontSize: 17,
                fontWeight: thread.unread ? "700" : "500",
              }}
            >
              {sender}
            </Text>
            {thread.starred && <Icon name="star" size={12} color={t.secondary} filled />}
            <Text style={{ color: t.secondary, fontSize: 13 }}>
              {messageTime(thread.receivedAt)}
            </Text>
          </View>
          <Text
            numberOfLines={1}
            style={{ color: t.ink, fontSize: 15, fontWeight: thread.unread ? "600" : "400" }}
          >
            {subject}
            {thread.messageCount > 1 ? ` · ${thread.messageCount}` : ""}
          </Text>
          <Text numberOfLines={2} style={{ color: t.secondary, fontSize: 15, lineHeight: 21 }}>
            {thread.snippet || "No preview available"}
          </Text>
        </View>
      </Pressable>
      <RowActions label={`Actions for ${subject}`} actions={actions} />
    </View>
  );
}
