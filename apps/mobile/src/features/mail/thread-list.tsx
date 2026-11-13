import type { MailThreadSummary } from "@personal-os/domain";
import { useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, FlatList, Pressable, Text, View } from "react-native";
import { Icon } from "../../components/icons";
import { PageRefreshControl } from "../../components/page-refresh";
import { useWorkspaceHeaderInset } from "../../components/workspace-header-inset";
import { spacing, touchTarget, useTheme } from "../../theme";
import {
  confirmMailRead,
  retryMailRead,
  useMailAccounts,
  useMailRevalidation,
  useMailThreads,
} from "./data";
import { type MailScope, mergeMailPages, scopeTitle } from "./logic";
import { MailReader } from "./reader";
import { ThreadRow } from "./thread-row";

/** A mailbox's conversations with server search, paging and the reader. */
export function MailThreadList({ scope, onBack }: { scope: MailScope; onBack?: () => void }) {
  const t = useTheme();
  const inset = useWorkspaceHeaderInset();
  const { mailSearch = "" } = useLocalSearchParams<{ mailSearch?: string }>();
  const { threads, query, searching } = useMailThreads(scope, mailSearch);
  const accounts = useMailAccounts();
  useMailRevalidation();
  const [open, setOpen] = useState<MailThreadSummary | null>(null);
  const rows = mergeMailPages(threads.data?.pages);
  const title = scopeTitle(scope);
  const unconnected = scope.kind === "inbox" && accounts.data?.length === 0;
  const link = (label: string, onPress: () => void) => (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={{ minHeight: touchTarget, alignItems: "center", justifyContent: "center" }}
    >
      <Text style={{ color: t.information, fontSize: 17 }}>{label}</Text>
    </Pressable>
  );
  return (
    <View style={{ flex: 1, backgroundColor: t.canvas }}>
      <FlatList
        data={rows}
        keyExtractor={(thread) => thread.id}
        contentInsetAdjustmentBehavior="never"
        scrollIndicatorInsets={{ top: inset }}
        contentContainerStyle={{ paddingTop: inset + spacing.sm, paddingBottom: 100, flexGrow: 1 }}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <PageRefreshControl
            offset={inset}
            onRefresh={() =>
              Promise.all([confirmMailRead(threads.refetch()), confirmMailRead(accounts.refetch())])
            }
          />
        }
        ListHeaderComponent={
          <View style={{ paddingHorizontal: spacing.page, paddingBottom: spacing.sm }}>
            {onBack && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Back to mailboxes"
                onPress={onBack}
                style={{ minHeight: touchTarget, justifyContent: "center" }}
              >
                <Text style={{ color: t.information, fontSize: 17 }}>‹ Mailboxes</Text>
              </Pressable>
            )}
            <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
              <Text
                accessibilityRole="header"
                style={{ color: t.ink, fontSize: 28, fontWeight: "700", flex: 1 }}
              >
                {title}
              </Text>
              {searching && <ActivityIndicator accessibilityLabel="Searching mail" />}
            </View>
            {scope.kind === "mailbox" && (
              <Text style={{ color: t.secondary, fontSize: 13, marginTop: spacing.xs }}>
                {scope.account}
              </Text>
            )}
            {!!query && (
              <Text style={{ color: t.secondary, fontSize: 13, marginTop: spacing.xs }}>
                Results for “{query}”
              </Text>
            )}
          </View>
        }
        renderItem={({ item }) => <ThreadRow thread={item} onOpen={() => setOpen(item)} />}
        ItemSeparatorComponent={() => (
          <View style={{ marginLeft: 28, height: 0.5, backgroundColor: t.line }} />
        )}
        ListEmptyComponent={
          <View
            style={{ padding: spacing.xl, gap: spacing.md, alignItems: "center", marginTop: 60 }}
          >
            {threads.isPending ? (
              <ActivityIndicator accessibilityLabel={`Loading ${title}`} />
            ) : threads.isError ? (
              <>
                <Icon name="disconnected" size={36} color={t.secondary} />
                <Text style={{ color: t.ink, fontSize: 20, fontWeight: "600" }}>
                  Mail isn’t available
                </Text>
                {link("Try again", () => void retryMailRead(() => threads.refetch()))}
              </>
            ) : (
              <>
                <Icon name={query ? "search" : "inbox"} size={36} color={t.secondary} />
                <Text style={{ color: t.ink, fontSize: 20, fontWeight: "600" }}>
                  {query
                    ? "No matching messages"
                    : unconnected
                      ? "Your inbox starts here"
                      : scope.kind === "inbox"
                        ? "You’re all caught up"
                        : `No messages in ${title}`}
                </Text>
                <Text style={{ color: t.secondary, fontSize: 15, textAlign: "center" }}>
                  {query
                    ? "Try another search."
                    : unconnected
                      ? "Connect a mailbox in Settings to see your messages."
                      : scope.kind === "inbox"
                        ? "New messages will appear here."
                        : "Messages in this mailbox will appear here."}
                </Text>
              </>
            )}
          </View>
        }
        onEndReached={() => {
          if (threads.hasNextPage && !threads.isFetching && !threads.isFetchNextPageError)
            void threads.fetchNextPage();
        }}
        onEndReachedThreshold={0.5}
        ListFooterComponent={
          threads.isFetchingNextPage ? (
            <ActivityIndicator accessibilityLabel="Loading more messages" />
          ) : threads.hasNextPage ? (
            link("Load more messages", () => void retryMailRead(() => threads.fetchNextPage()))
          ) : undefined
        }
      />
      {open && <MailReader key={open.id} thread={open} close={() => setOpen(null)} />}
    </View>
  );
}
