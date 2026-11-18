import type { MailThreadSummary } from "@personal-os/domain";
import { useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Text, View } from "react-native";
import { BackLink } from "../../components/back-link";
import { Action } from "../../components/forms/form-rows";
import { Icon } from "../../components/icons";
import { PageRefreshControl } from "../../components/page-refresh";
import { SettingsAccentProvider } from "../../components/settings-accent";
import { useWorkspaceHeaderInset } from "../../components/workspace-header-inset";
import { spacing, useTheme } from "../../theme";
import { MailAttention } from "./attention";
import { MailComposer } from "./composer";
import {
  confirmMailRead,
  retryMailRead,
  useMailAccounts,
  useMailAttention,
  useMailRevalidation,
  useMailThreadRead,
  useMailThreads,
} from "./data";
import { newStart } from "./draft-logic";
import {
  conversations,
  MAIL_SELECTION_LIMIT,
  type MailScope,
  mergeMailPages,
  scopeTarget,
  scopeTitle,
  withMailChanges,
} from "./logic";
import { MailReader } from "./reader";
import { SnoozeSheet } from "./snooze-sheet";
import { ThreadRow } from "./thread-row";
import { type BulkAction, useMailTriage } from "./triage";

/**
 * A mailbox's conversations with server search, paging and the reader. A long press on a row
 * starts a selection, whose bar acts on every selected conversation still listed.
 */
export function MailThreadList({ scope, onBack }: { scope: MailScope; onBack?: () => void }) {
  const t = useTheme();
  const inset = useWorkspaceHeaderInset();
  const { mailSearch = "" } = useLocalSearchParams<{ mailSearch?: string }>();
  const { threads, query, searching } = useMailThreads(scope, mailSearch);
  const accounts = useMailAccounts();
  const inbox = scope.kind === "inbox";
  const attention = useMailAttention(inbox);
  const readThread = useMailThreadRead();
  const reading = useRef(0);
  useMailRevalidation();
  const triage = useMailTriage();
  const [opened, setOpen] = useState<MailThreadSummary | null>(null);
  const [writing, setWriting] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  // What a snooze sheet is choosing a time for: one conversation, or the selection.
  const [snoozing, setSnoozing] = useState<MailThreadSummary | "selection" | null>(null);
  const sender = accounts.data?.[0]?.accountId;
  const snoozed = scope.kind === "snoozed";
  const rows = withMailChanges(
    mergeMailPages(threads.data?.pages),
    triage.changes,
    scopeTarget(scope),
  );
  // The reader follows the listed conversation, so its actions act on the current state.
  const open = opened && (rows.find((thread) => thread.id === opened.id) ?? opened);
  const title = scopeTitle(scope);
  // The selection is what is still listed: a conversation that left the list left it too.
  const picked = rows.filter((thread) => selected.includes(thread.id));
  const selecting = picked.length > 0;
  const selectable = rows.slice(0, MAIL_SELECTION_LIMIT).map((thread) => thread.id);
  const toggle = (id: string) =>
    setSelected(() => {
      const live = picked.map((thread) => thread.id);
      if (live.includes(id)) return live.filter((other) => other !== id);
      return live.length < MAIL_SELECTION_LIMIT ? [...live, id] : live;
    });
  // A search shows a different list, so a selection never carries over to it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset only when the search changes.
  useEffect(() => setSelected([]), [query]);
  const perform = (action: BulkAction, until?: Date) =>
    triage.bulk(action, picked, setSelected, until);
  // How many selected conversations an action would change; its control names that number.
  const able = (action: BulkAction) =>
    picked.filter((thread) => triage.allows(action, thread)).length;
  const actions = (thread: MailThreadSummary, onLeave?: () => void) =>
    triage.actions(thread, { onLeave, snoozed, onSnooze: () => setSnoozing(thread) });
  // An attention item can be about a conversation this list has not loaded; read that one.
  const openThread = (id: string) => {
    reading.current += 1;
    const request = reading.current;
    const listed = rows.find((thread) => thread.id === id);
    if (listed) return setOpen(listed);
    void readThread(id).then((thread) => {
      if (thread && request === reading.current) setOpen(thread);
    });
  };
  const sheet = snoozing && (
    <SnoozeSheet
      count={snoozing === "selection" ? picked.length : 1}
      close={() => setSnoozing(null)}
      choose={(until) => {
        setSnoozing(null);
        if (snoozing === "selection") perform("snooze", until);
        else triage.snooze(snoozing, until, () => setOpen(null));
      }}
    />
  );
  const unconnected = scope.kind === "inbox" && accounts.data?.length === 0;
  const link = (label: string, onPress: () => void) => (
    <SettingsAccentProvider workspace="mail">
      <View style={{ alignItems: "center" }}>
        <Action label={label} onPress={onPress} />
      </View>
    </SettingsAccentProvider>
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
              Promise.all([
                confirmMailRead(threads.refetch()),
                confirmMailRead(accounts.refetch()),
                ...(inbox ? [confirmMailRead(attention.refetch())] : []),
              ])
            }
          />
        }
        ListHeaderComponent={
          <View style={{ paddingHorizontal: spacing.page, paddingBottom: spacing.sm }}>
            {onBack && (
              <BackLink label="Mailboxes" accessibilityLabel="Back to mailboxes" onPress={onBack} />
            )}
            <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
              <Text
                accessibilityRole="header"
                style={{ color: t.ink, fontSize: 28, fontWeight: "700", flex: 1 }}
              >
                {title}
              </Text>
              {searching && <ActivityIndicator accessibilityLabel="Searching mail" />}
              {sender && (
                <SettingsAccentProvider workspace="mail">
                  <Action label="New message" onPress={() => setWriting(true)} />
                </SettingsAccentProvider>
              )}
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
            {selecting && (
              <SettingsAccentProvider workspace="mail">
                <View
                  style={{
                    flexDirection: "row",
                    flexWrap: "wrap",
                    alignItems: "center",
                    marginTop: spacing.sm,
                    marginLeft: -spacing.md,
                  }}
                >
                  <Text style={{ color: t.ink, paddingHorizontal: spacing.md }}>
                    {picked.length} selected
                  </Text>
                  <Action label="Cancel" onPress={() => setSelected([])} />
                  {selectable.some((id) => !selected.includes(id)) && (
                    <Action
                      label="Select all"
                      disabled={triage.pending}
                      onPress={() => setSelected(selectable)}
                    />
                  )}
                  {able("read") > 0 && (
                    <Action
                      label="Mark as read"
                      accessibilityLabel={`Mark ${conversations(able("read"))} as read`}
                      disabled={triage.pending}
                      onPress={() => perform("read")}
                    />
                  )}
                  {able("unread") > 0 && (
                    <Action
                      label="Mark as unread"
                      accessibilityLabel={`Mark ${conversations(able("unread"))} as unread`}
                      disabled={triage.pending}
                      onPress={() => perform("unread")}
                    />
                  )}
                  {able("archive") === picked.length && (
                    <Action
                      label="Archive"
                      accessibilityLabel={`Archive ${conversations(picked.length)}`}
                      disabled={triage.pending}
                      onPress={() => perform("archive")}
                    />
                  )}
                  {snoozed ? (
                    <Action
                      label="End snooze"
                      accessibilityLabel={`End the snooze on ${conversations(picked.length)}`}
                      disabled={triage.pending}
                      onPress={() => perform("unsnooze")}
                    />
                  ) : (
                    <Action
                      label="Snooze"
                      accessibilityLabel={`Snooze ${conversations(picked.length)}`}
                      disabled={triage.pending}
                      onPress={() => setSnoozing("selection")}
                    />
                  )}
                </View>
              </SettingsAccentProvider>
            )}
            {/* The selection bar and search results own this space while they are showing. */}
            {inbox && !selecting && !query && <MailAttention onOpen={openThread} />}
          </View>
        }
        renderItem={({ item }) => (
          <ThreadRow
            thread={item}
            actions={actions(item)}
            selecting={selecting}
            marked={selected.includes(item.id)}
            onSelect={() => toggle(item.id)}
            onOpen={() => setOpen(item)}
          />
        )}
        ItemSeparatorComponent={() => (
          <View style={{ marginLeft: 28, height: 0.5, backgroundColor: t.line }} />
        )}
        ListEmptyComponent={
          <View
            style={{ padding: spacing.xl, gap: spacing.md, alignItems: "center", marginTop: 60 }}
          >
            {searching ? null : threads.isPending ? (
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
                        : snoozed
                          ? "Nothing is snoozed"
                          : `No messages in ${title}`}
                </Text>
                <Text style={{ color: t.secondary, fontSize: 15, textAlign: "center" }}>
                  {query
                    ? "Try another search."
                    : unconnected
                      ? "Connect a mailbox in Settings to see your messages."
                      : scope.kind === "inbox"
                        ? "New messages will appear here."
                        : snoozed
                          ? "Conversations you snooze wait here until they return."
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
          ) : threads.isFetchNextPageError ? (
            // Paging is automatic; the command appears only to retry a page that failed.
            link("Load more messages", () => void retryMailRead(() => threads.fetchNextPage()))
          ) : undefined
        }
      />
      {open && (
        <MailReader
          key={open.id}
          thread={open}
          actions={actions(open, () => setOpen(null))}
          compose
          sheet={sheet}
          close={() => setOpen(null)}
        />
      )}
      {!open && sheet}
      {writing && sender && (
        <MailComposer start={newStart(sender)} close={() => setWriting(false)} />
      )}
    </View>
  );
}
