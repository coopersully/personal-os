import type { MailThreadSummary } from "@personal-os/domain";
import { useLocalSearchParams } from "expo-router";
import type { ReactNode } from "react";
import { useState } from "react";
import { ActivityIndicator, FlatList, Pressable, Text, View } from "react-native";
import { Icon } from "../../components/icons";
import { usePageRefresh } from "../../components/page-refresh";
import { useWorkspaceHeaderInset } from "../../components/workspace-header-inset";
import { spacing, useTheme } from "../../theme";
import { useInbox, useMailAction } from "./data";
import { MailFilters } from "./filters";
import { MailReader } from "./reader";
import { type MailFolder, mailFolders, useMailScope } from "./scope";
import { ThreadRow } from "./thread-row";

export function MailInbox({
  folder = "inbox",
  onBack,
  extra,
}: {
  folder?: MailFolder;
  onBack?: () => void;
  extra?: ReactNode;
} = {}) {
  const t = useTheme();
  const inset = useWorkspaceHeaderInset();
  const { mailSearch = "" } = useLocalSearchParams<{ mailSearch?: string }>();
  const { accountId, accountLabel } = useMailScope();
  const title = mailFolders.find((item) => item.role === folder)?.label ?? "Inbox";
  const [filters, setFilters] = useState<{ unread?: true; starred?: true }>({});
  const { inbox, boxes, searching } = useInbox(mailSearch, folder, accountId, filters);
  const actions = useMailAction(boxes.data ?? []);
  const [selected, setSelected] = useState<MailThreadSummary | null>(null);
  const threads = [
    ...new Map((inbox.data?.pages.flat() ?? []).map((thread) => [thread.id, thread])).values(),
  ];
  const current = threads.find((thread) => thread.id === selected?.id) ?? selected;
  const refresh = usePageRefresh(["mail"], async () => {
    const results = await Promise.all([inbox.refetch(), boxes.refetch()]);
    if (results.some((result) => result.isError)) throw new Error("Couldn’t refresh mail");
  });
  return (
    <View style={{ flex: 1, backgroundColor: t.canvas }}>
      <FlatList
        data={threads}
        keyExtractor={(thread) => thread.id}
        contentInsetAdjustmentBehavior="never"
        scrollIndicatorInsets={{ top: inset }}
        contentContainerStyle={{ paddingTop: inset + spacing.lg, paddingBottom: 100, flexGrow: 1 }}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        refreshing={refresh.refreshing}
        onRefresh={() => void refresh.refresh()}
        progressViewOffset={inset}
        ListHeaderComponent={
          <View style={{ paddingHorizontal: spacing.page, paddingBottom: spacing.md }}>
            {onBack && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Back to Mailboxes"
                onPress={onBack}
                style={{ minHeight: 44, justifyContent: "center" }}
              >
                <Text style={{ color: t.information, fontSize: 17 }}>‹ Mailboxes</Text>
              </Pressable>
            )}
            <Text
              accessibilityRole="header"
              style={{ color: t.ink, fontSize: 28, fontWeight: "700" }}
            >
              {title}
            </Text>
            {accountId && (
              <Text style={{ color: t.secondary, fontSize: 13, marginTop: spacing.xs }}>
                {accountLabel}
              </Text>
            )}
            {searching && <ActivityIndicator accessibilityLabel="Searching mail" />}
            {folder === "inbox" && <MailFilters value={filters} onChange={setFilters} />}
            {extra}
          </View>
        }
        renderItem={({ item }) => (
          <ThreadRow
            thread={item}
            pending={actions.pending.has(item.id)}
            canArchive={folder === "inbox" && !!boxes.data && !boxes.isError}
            onAction={(action) => void actions.run(item, action)}
            onOpen={() => setSelected(item)}
          />
        )}
        ItemSeparatorComponent={() => (
          <View style={{ marginLeft: 28, height: 0.5, backgroundColor: t.line }} />
        )}
        ListEmptyComponent={
          <View
            style={{
              padding: spacing.xl,
              gap: spacing.md,
              alignItems: "center",
              marginTop: folder === "drafts" ? 12 : 60,
            }}
          >
            {inbox.isPending ? (
              <ActivityIndicator accessibilityLabel="Loading inbox" />
            ) : inbox.isError ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => void refresh.refresh()}
                style={{ minHeight: 44, justifyContent: "center" }}
              >
                <Text style={{ color: t.information, fontSize: 17 }}>Reload inbox</Text>
              </Pressable>
            ) : folder === "drafts" ? (
              <Text style={{ color: t.secondary, fontSize: 15 }}>
                {mailSearch ? "No matching mailbox drafts." : "No drafts in this mailbox."}
              </Text>
            ) : (
              <>
                <Icon
                  name={mailFolders.find((item) => item.role === folder)?.icon ?? "inbox"}
                  size={36}
                  color={t.secondary}
                />
                <Text style={{ color: t.ink, fontSize: 20, fontWeight: "600" }}>
                  {mailSearch || filters.unread || filters.starred
                    ? "No matching messages"
                    : boxes.data?.length === 0
                      ? "Your inbox starts here"
                      : folder === "inbox"
                        ? "You’re all caught up"
                        : `No messages in ${title.toLowerCase()}`}
                </Text>
                <Text style={{ color: t.secondary, fontSize: 15, textAlign: "center" }}>
                  {mailSearch || filters.unread || filters.starred
                    ? "Try another search or turn off a filter."
                    : boxes.data?.length === 0
                      ? "Connect a mailbox in Settings to see your messages."
                      : folder === "inbox"
                        ? "New inbox messages will appear here."
                        : "Messages in this folder will appear here."}
                </Text>
              </>
            )}
          </View>
        }
        onEndReached={() => {
          if (inbox.hasNextPage && !inbox.isFetching && !inbox.isFetchNextPageError)
            void inbox.fetchNextPage();
        }}
        onEndReachedThreshold={0.5}
        ListFooterComponent={
          inbox.isFetchingNextPage ? (
            <ActivityIndicator accessibilityLabel="Loading more messages" />
          ) : inbox.hasNextPage ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => void inbox.fetchNextPage()}
              style={{ minHeight: 44, alignItems: "center", justifyContent: "center" }}
            >
              <Text style={{ color: t.information }}>Load more messages</Text>
            </Pressable>
          ) : undefined
        }
      />
      {current && (
        <MailReader
          key={current.id}
          thread={current}
          close={() => setSelected(null)}
          pending={actions.pending.has(current.id)}
          canArchive={folder === "inbox" && !!boxes.data && !boxes.isError}
          onAction={(action) => void actions.run(current, action)}
        />
      )}
    </View>
  );
}
