import type { MailAddress, MailThreadSummary } from "@personal-os/domain";
import { ActivityIndicator, Modal, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Action, Actions } from "../../components/forms/form-rows";
import { Icon } from "../../components/icons";
import { PageRefreshControl } from "../../components/page-refresh";
import { SettingsAccentProvider } from "../../components/settings-accent";
import { SheetHeader } from "../../components/sheet-header";
import { spacing, useTheme } from "../../theme";
import { confirmMailRead, retryMailRead, useMailMessages } from "./data";
import { senderName } from "./logic";

const people = (addresses: MailAddress[]) => addresses.map(senderName).join(", ");

/** Reads one conversation. Its messages live in memory only while this sheet is open. */
export function MailReader({ thread, close }: { thread: MailThreadSummary; close: () => void }) {
  const t = useTheme();
  const messages = useMailMessages(thread.id);
  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={close}>
      <SafeAreaView style={{ flex: 1, backgroundColor: t.canvas }}>
        <SheetHeader title="Conversation" onClose={close} />
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
      </SafeAreaView>
    </Modal>
  );
}
