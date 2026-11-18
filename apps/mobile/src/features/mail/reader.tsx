import type { MailAddress, MailThreadSummary } from "@personal-os/domain";
import { useState } from "react";
import { ActivityIndicator, Modal, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Action, Actions } from "../../components/forms/form-rows";
import { Icon } from "../../components/icons";
import { PageRefreshControl } from "../../components/page-refresh";
import type { RowAction } from "../../components/row-action-button";
import { RowActions } from "../../components/row-actions";
import { SettingsAccentProvider } from "../../components/settings-accent";
import { SheetHeader } from "../../components/sheet-header";
import { spacing, useTheme } from "../../theme";
import { MailComposer } from "./composer";
import { confirmMailRead, retryMailRead, useMailAccounts, useMailMessages } from "./data";
import { type ComposeStart, forwardStart, replyStart } from "./draft-logic";
import { senderName } from "./logic";

const people = (addresses: MailAddress[]) => addresses.map(senderName).join(", ");

/**
 * Reads one conversation. Its messages live in memory only while this sheet is open. A caller
 * that cannot change the conversation passes no `actions`, and the header shows no control.
 * With `compose`, the loaded conversation also offers Reply and Forward; the composer opens
 * inside this sheet, so closing it returns to the conversation.
 */
export function MailReader({
  thread,
  actions,
  compose = false,
  close,
}: {
  thread: MailThreadSummary;
  actions?: readonly RowAction[];
  compose?: boolean;
  close: () => void;
}) {
  const t = useTheme();
  const messages = useMailMessages(thread.id);
  const accounts = useMailAccounts();
  const [composing, setComposing] = useState<ComposeStart | null>(null);
  const loaded = messages.data;
  const own = accounts.data?.find((account) => account.accountId === thread.accountId)?.email;
  // A reply needs the person's own address to tell their messages from the other party's, so
  // it waits for that; a forward needs only the loaded conversation.
  const offered: readonly RowAction[] = [
    ...(compose && loaded?.length && own
      ? [
          {
            id: "reply",
            label: "Reply",
            icon: "reply" as const,
            onPress: () => setComposing(replyStart(thread, loaded, own)),
          },
        ]
      : []),
    ...(compose && loaded?.length
      ? [
          {
            id: "forward",
            label: "Forward",
            icon: "send" as const,
            onPress: () => setComposing(forwardStart(thread, loaded)),
          },
        ]
      : []),
    ...(actions ?? []),
  ];
  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={close}>
      <SafeAreaView style={{ flex: 1, backgroundColor: t.canvas }}>
        <SheetHeader
          title="Conversation"
          onClose={close}
          trailing={
            offered.length ? (
              <RowActions placement="header" label="Conversation actions" actions={offered} />
            ) : undefined
          }
        />
        <ScrollView
          alwaysBounceVertical
          refreshControl={
            <PageRefreshControl onRefresh={() => confirmMailRead(messages.refetch())} />
          }
          contentContainerStyle={{ padding: spacing.page, gap: spacing.xl }}
        >
          <Text
            accessibilityRole="header"
            style={{ color: t.ink, fontWeight: "700", fontSize: 26 }}
          >
            {thread.subject || "No subject"}
          </Text>
          {messages.isPending && <ActivityIndicator accessibilityLabel="Loading conversation" />}
          {messages.isError && !messages.data && (
            <View style={{ gap: spacing.sm }}>
              <Text style={{ color: t.ink, fontSize: 17, fontWeight: "600" }}>
                This conversation isn’t available
              </Text>
              <Text style={{ color: t.secondary, fontSize: 15, lineHeight: 21 }}>
                Message text is never stored on this iPhone, so reading it needs a connection.
              </Text>
              <SettingsAccentProvider workspace="mail">
                {/* The row sizes the line to its label, so the label starts on the copy's edge. */}
                <View style={{ flexDirection: "row" }}>
                  <Actions inset={false}>
                    <Action
                      label="Try again"
                      onPress={() => void retryMailRead(() => messages.refetch())}
                    />
                  </Actions>
                </View>
              </SettingsAccentProvider>
            </View>
          )}
          {messages.data?.length === 0 && (
            <Text style={{ color: t.secondary, fontSize: 15 }}>
              This conversation has no messages to show.
            </Text>
          )}
          {messages.data?.map((message) => (
            <View key={message.id} style={{ gap: spacing.md }}>
              <View style={{ gap: 4 }}>
                <Text style={{ color: t.ink, fontSize: 17, fontWeight: "600" }}>
                  {senderName(message.from)}
                </Text>
                <Text style={{ color: t.secondary, fontSize: 13, lineHeight: 18 }}>
                  {message.from.address}
                  {message.to.length ? `\nTo ${people(message.to)}` : ""}
                  {message.cc.length ? `\nCc ${people(message.cc)}` : ""}
                  {"\n"}
                  {new Date(message.receivedAt).toLocaleString(undefined, {
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </Text>
              </View>
              <Text selectable style={{ color: t.ink, fontSize: 17, lineHeight: 25 }}>
                {message.bodyText || "This message has no text content."}
              </Text>
              {message.attachments.map((file) => (
                <View
                  key={file.id}
                  accessible
                  accessibilityLabel={`Attachment ${file.filename || "untitled"}`}
                  style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}
                >
                  <Icon name="receipt" size={16} color={t.secondary} />
                  <Text numberOfLines={1} style={{ color: t.secondary, fontSize: 15, flex: 1 }}>
                    {file.filename || "Untitled attachment"}
                  </Text>
                </View>
              ))}
              <View style={{ height: 0.5, backgroundColor: t.line }} />
            </View>
          ))}
        </ScrollView>
        {composing && <MailComposer start={composing} close={() => setComposing(null)} />}
      </SafeAreaView>
    </Modal>
  );
}
