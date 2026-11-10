import type { MailThreadSummary } from "@personal-os/domain";
import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { useRef, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { EditorClose } from "../../components/editor-close";
import { GlassSurface } from "../../components/glass-surface";
import { Icon } from "../../components/icons";
import { PageRefreshControl } from "../../components/page-refresh";
import { RowActions } from "../../components/row-actions";
import { spacing, useTheme } from "../../theme";
import { useAuth } from "../auth/context";
import { Attachments } from "./attachments";
import type { MailAction } from "./logic";
import type { ReplyMode } from "./reply";

/** Body reads are authenticated, memory-only and discarded when this sheet unmounts. */
export function MailReader({
  thread,
  close,
  onAction,
  pending,
  canArchive,
}: {
  thread: MailThreadSummary;
  close: () => void;
  pending: boolean;
  canArchive: boolean;
  onAction: (action: MailAction) => void;
}) {
  const t = useTheme();
  const [dismissing, setDismissing] = useState(false);
  const composeTarget = useRef<{ messageId: string; mode: ReplyMode } | null>(null);
  const finishCompose = () => {
    const target = composeTarget.current;
    if (!target) return;
    composeTarget.current = null;
    close();
    router.push({ pathname: "/mail-compose", params: { threadId: thread.id, ...target } });
  };
  const compose = (messageId: string, mode: ReplyMode) => {
    if (composeTarget.current) return;
    composeTarget.current = { messageId, mode };
    if (Platform.OS === "ios") setDismissing(true);
    else finishCompose();
  };
  const { session, state } = useAuth();
  const messages = useQuery({
    queryKey: ["mail", state.user?.id, "messages", thread.id],
    queryFn: () => session.api().listMailMessages(thread.id),
    gcTime: 0,
    staleTime: 0,
  });
  return (
    <Modal
      visible={!dismissing}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={close}
      onDismiss={finishCompose}
    >
      <SafeAreaView style={{ flex: 1, backgroundColor: t.canvas }}>
        <View
          style={{
            flexDirection: "row",
            justifyContent: "space-between",
            alignItems: "center",
            paddingHorizontal: spacing.page,
            paddingVertical: spacing.sm,
            minHeight: 60,
          }}
        >
          <EditorClose label="Close" onPress={close} />
          <GlassSurface style={{ width: 44, height: 44, borderRadius: 22, overflow: "hidden" }}>
            <RowActions
              placement="toolbar"
              label="Message actions"
              actions={[
                {
                  id: "read",
                  label: thread.unread ? "Mark as read" : "Mark as unread",
                  icon: "mail",
                  disabled: pending,
                  onPress: () => onAction("read"),
                },
                {
                  id: "archive",
                  label: "Archive",
                  icon: "archive",
                  disabled: pending || !canArchive,
                  onPress: () => {
                    onAction("archive");
                    close();
                  },
                },
              ]}
            />
          </GlassSurface>
        </View>
        <ScrollView
          alwaysBounceVertical
          refreshControl={<PageRefreshControl scope={["mail"]} />}
          contentContainerStyle={{ padding: spacing.page, gap: spacing.xl }}
        >
          <Text
            accessibilityRole="header"
            style={{ color: t.ink, fontWeight: "700", fontSize: 26 }}
          >
            {thread.subject || "No subject"}
          </Text>
          {messages.isPending && <ActivityIndicator accessibilityLabel="Loading message" />}
          {messages.isError && (
            <Pressable
              accessibilityRole="button"
              onPress={() => void messages.refetch()}
              style={{ minHeight: 44, flexDirection: "row", alignItems: "center", gap: 8 }}
            >
              <Icon name="mail" color={t.information} />
              <Text style={{ color: t.information }}>Load message</Text>
            </Pressable>
          )}
          {messages.data?.map((message) => (
            <View key={message.id} style={{ gap: spacing.md }}>
              <View style={{ flexDirection: "row", alignItems: "flex-start", gap: spacing.md }}>
                <View style={{ gap: 4, flex: 1 }}>
                  <Text style={{ color: t.ink, fontSize: 17, fontWeight: "600" }}>
                    {message.from.name || message.from.address}
                  </Text>
                  <Text style={{ color: t.secondary, fontSize: 13 }}>
                    {message.from.address}
                    {"\n"}
                    {new Date(message.receivedAt).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </Text>
                </View>
                <RowActions
                  label={`Reply or forward ${message.from.name || message.from.address}`}
                  actions={[
                    {
                      id: "reply",
                      label: "Reply",
                      icon: "reply",
                      onPress: () => compose(message.id, "reply"),
                    },
                    {
                      id: "replyAll",
                      label: "Reply all",
                      icon: "reply",
                      onPress: () => compose(message.id, "replyAll"),
                    },
                    {
                      id: "forward",
                      label: "Forward",
                      icon: "forward",
                      onPress: () => compose(message.id, "forward"),
                    },
                  ]}
                />
              </View>
              <Text selectable style={{ color: t.ink, fontSize: 17, lineHeight: 25 }}>
                {message.bodyText || "This message has no text content."}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Reply to ${message.from.name || message.from.address}`}
                onPress={() => compose(message.id, "reply")}
                style={{
                  minHeight: 44,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: spacing.sm,
                  alignSelf: "flex-start",
                  paddingHorizontal: spacing.sm,
                }}
              >
                <Icon name="reply" color={t.information} />
                <Text style={{ color: t.information, fontSize: 17 }}>Reply</Text>
              </Pressable>
              <Attachments
                files={message.attachments}
                load={(file) => session.api().downloadMailAttachment(message.id, file.id)}
              />
              <View style={{ height: 1, backgroundColor: t.line }} />
            </View>
          ))}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}
