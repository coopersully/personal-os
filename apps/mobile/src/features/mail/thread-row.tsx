import type { MailThreadSummary } from "@personal-os/domain";
import * as Haptics from "expo-haptics";
import { useRef } from "react";
import { Pressable, Text, View } from "react-native";
import ReanimatedSwipeable, {
  type SwipeableMethods,
} from "react-native-gesture-handler/ReanimatedSwipeable";
import { Icon } from "../../components/icons";
import { spacing, useTheme } from "../../theme";
import { type MailAction, messageTime, swipeAction } from "./logic";

export function ThreadRow({
  thread,
  pending,
  canArchive,
  onAction,
  onOpen,
}: {
  thread: MailThreadSummary;
  pending: boolean;
  canArchive: boolean;
  onAction: (action: MailAction) => void;
  onOpen: () => void;
}) {
  const t = useTheme();
  const swipe = useRef<SwipeableMethods>(null);
  const sender = thread.from.name?.trim() || thread.from.address;
  const act = (action: MailAction) => {
    swipe.current?.close();
    if (pending || (action === "archive" && !canArchive)) return;
    void Haptics.selectionAsync().catch(() => {});
    onAction(action);
  };
  const actionPanel = (action: MailAction) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={
        action === "archive" ? "Archive message" : thread.unread ? "Mark as read" : "Mark as unread"
      }
      disabled={pending}
      onPress={() => act(action)}
      style={{
        width: 100,
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        backgroundColor: action === "archive" ? "#23784f" : "#235ec5",
      }}
    >
      <Icon name={action === "archive" ? "archive" : "mail"} color="#ffffff" size={24} />
      <Text style={{ color: "#ffffff", fontSize: 13, fontWeight: "600" }}>
        {action === "archive" ? "Archive" : thread.unread ? "Read" : "Unread"}
      </Text>
    </Pressable>
  );
  return (
    <ReanimatedSwipeable
      ref={swipe}
      friction={1.5}
      leftThreshold={70}
      rightThreshold={70}
      overshootLeft={false}
      overshootRight={false}
      renderLeftActions={pending ? undefined : () => actionPanel("read")}
      renderRightActions={pending || !canArchive ? undefined : () => actionPanel("archive")}
      onSwipeableOpen={(direction) => act(swipeAction(direction))}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${thread.unread ? "Unread. " : ""}${sender}. ${thread.subject || "No subject"}. ${thread.snippet}`}
        accessibilityState={{ busy: pending, disabled: pending }}
        disabled={pending}
        accessibilityActions={[
          { name: "read", label: thread.unread ? "Mark as read" : "Mark as unread" },
          ...(canArchive ? [{ name: "archive", label: "Archive" }] : []),
        ]}
        onAccessibilityAction={({ nativeEvent }) => {
          if (nativeEvent.actionName === "read" || nativeEvent.actionName === "archive")
            act(nativeEvent.actionName);
        }}
        onPress={() => {
          swipe.current?.close();
          onOpen();
        }}
        style={{
          backgroundColor: t.canvas,
          flexDirection: "row",
          paddingVertical: spacing.lg,
          paddingRight: spacing.page,
          opacity: pending ? 0.5 : 1,
        }}
      >
        <View style={{ width: 28, alignItems: "center", paddingTop: 7 }}>
          {thread.unread && (
            <View
              style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: t.information }}
            />
          )}
        </View>
        <View style={{ flex: 1, gap: 3 }}>
          <View style={{ flexDirection: "row", gap: 8, alignItems: "baseline" }}>
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
            <Text style={{ color: t.secondary, fontSize: 13 }}>
              {messageTime(thread.receivedAt)}
            </Text>
            <Icon name="chevron" size={12} color={t.secondary} />
          </View>
          <Text
            numberOfLines={1}
            style={{ color: t.ink, fontSize: 15, fontWeight: thread.unread ? "600" : "400" }}
          >
            {thread.subject || "No subject"}
            {thread.messageCount > 1 ? ` · ${thread.messageCount}` : ""}
          </Text>
          <Text numberOfLines={2} style={{ color: t.secondary, fontSize: 15, lineHeight: 21 }}>
            {thread.snippet || "No preview available"}
          </Text>
        </View>
      </Pressable>
    </ReanimatedSwipeable>
  );
}
