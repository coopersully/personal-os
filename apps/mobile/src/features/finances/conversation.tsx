import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { router, useFocusEffect } from "expo-router";
import { type ComponentRef, useCallback, useEffect, useRef, useState } from "react";
import { AppState, Keyboard, Platform, ScrollView, Text, View } from "react-native";
import { radius, spacing, useTheme } from "../../theme";
import { ConversationComposer } from "./conversation-composer";
import { conversationUnreadKey, useConversationUnread } from "./conversation-unread";
import { useFinance } from "./data";
import { Copy, FinanceRow, ReadState } from "./ui";

const referenceLabels = {
  transaction: "Attached transaction",
  account: "View account",
  budget_plan: "View budget proposal",
  review_batch: "Review grouped decisions",
  budget_start_preview: "Review starting month",
  review_batch_undo: "Review correction",
  review_case: "View review case",
  contextual_question: "View question",
} as const;

/** Render the agent's supported formatting as native text. Record references own navigation. */
function agentMessageText(text: string) {
  const content = text.replace(/^([ \t]*)[-*][ \t]+(?=\S)/gm, "$1• ");
  const spans = [];
  let cursor = 0;
  for (const match of content.matchAll(/\*\*([^*\r\n]+)\*\*/g)) {
    const start = match.index;
    spans.push(content.slice(cursor, start));
    spans.push(
      <Text key={start} style={{ fontWeight: "700" }}>
        {match[1]}
      </Text>,
    );
    cursor = start + match[0].length;
  }
  spans.push(content.slice(cursor));
  return spans;
}

/** The transcript scrolls independently; composer and page controls never join its content. */
export function Conversation() {
  const { api, owner } = useFinance();
  const t = useTheme();
  const frame = useRef<ComponentRef<typeof View>>(null);
  const transcript = useRef<ComponentRef<typeof ScrollView>>(null);
  const nearBottom = useRef(true);
  const [keyboardInset, setKeyboardInset] = useState(0);
  const client = useQueryClient();
  const unread = useConversationUnread();
  // Native tabs stay mounted, so a mounted transcript is not necessarily one being read.
  const [visible, setVisible] = useState(false);
  const marked = useRef(0n);
  const query = useInfiniteQuery({
    meta: { scopedReadFeedback: true },
    queryKey: ["finances", owner, "conversation"],
    enabled: !!owner,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      api.getFinanceConversationHistory(
        pageParam ? { before: pageParam, limit: 50 } : { latest: true, limit: 50 },
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
  // Replies arrive after the send receipt. Refresh only while this transcript is visible.
  const refresh = query.refetch;
  useFocusEffect(
    useCallback(() => {
      if (!owner) return;
      let active = AppState.currentState === "active";
      setVisible(active);
      const poll = () => {
        if (active) void refresh();
      };
      const timer = setInterval(poll, 5_000);
      const listener = AppState.addEventListener("change", (state) => {
        active = state === "active";
        setVisible(active);
        if (active) poll();
      });
      return () => {
        setVisible(false);
        clearInterval(timer);
        listener.remove();
      };
    }, [owner, refresh]),
  );
  const messages =
    query.data?.pages
      .slice()
      .reverse()
      .flatMap((page) => page.messages) ?? [];
  // A message without a usable sequence cannot be placed, so nothing is marked read around it.
  const sequences = messages.map((message) =>
    /^\d+$/.test(String(message.sequence)) ? BigInt(message.sequence) : null,
  );
  const placed = sequences.every((value) => value !== null);
  const newest = sequences.reduce<bigint>((max, value) => (value && value > max ? value : max), 0n);
  const readThrough = unread?.readThrough;
  /**
   * Records the conversation as read through its latest message. Opening the tab alone never
   * does; showing the transcript does, however many earlier messages are still unloaded, so a
   * read mark far behind the latest page cannot leave the unread badge standing.
   */
  const markSeen = useCallback(() => {
    if (!visible || !placed || !nearBottom.current || readThrough === undefined) return;
    if (newest <= readThrough || newest <= marked.current) return;
    marked.current = newest;
    void api
      .markFinanceConversationRendered(newest.toString())
      .then(() => client.invalidateQueries({ queryKey: conversationUnreadKey(owner) }))
      // Unconfirmed, so the next chance to mark these messages is taken again.
      .catch(() => {
        if (marked.current === newest) marked.current = 0n;
      });
  }, [api, client, owner, visible, placed, newest, readThrough]);
  useEffect(markSeen, [markSeen]);
  // Measure the actual composer region, accounting for the native tab bar and workspace header.
  useEffect(() => {
    let active = true;
    const show = Keyboard.addListener(
      Platform.OS === "ios" ? "keyboardWillChangeFrame" : "keyboardDidShow",
      (event) => {
        frame.current?.measureInWindow((_x, y, _width, height) => {
          if (active) setKeyboardInset(Math.max(0, y + height - event.endCoordinates.screenY));
        });
      },
    );
    const hide = Keyboard.addListener("keyboardDidHide", () => setKeyboardInset(0));
    return () => {
      active = false;
      show.remove();
      hide.remove();
    };
  }, []);
  return (
    <View ref={frame} style={{ flex: 1, minHeight: 0 }}>
      <View style={{ flex: 1, minHeight: 0, paddingBottom: keyboardInset }}>
        <View style={{ flex: 1, minHeight: 0 }}>
          <ReadState
            query={{ ...query, feedbackKey: JSON.stringify(["finances", owner, "conversation"]) }}
          >
            <ScrollView
              ref={transcript}
              accessibilityLabel="Finance conversation history"
              style={{ flex: 1 }}
              contentInsetAdjustmentBehavior="never"
              keyboardDismissMode="interactive"
              keyboardShouldPersistTaps="handled"
              scrollEventThrottle={32}
              maintainVisibleContentPosition={{ minIndexForVisible: 1 }}
              onScroll={({ nativeEvent: { contentOffset, layoutMeasurement, contentSize } }) => {
                nearBottom.current =
                  contentSize.height - layoutMeasurement.height - contentOffset.y < 80;
                markSeen();
              }}
              onContentSizeChange={() => {
                if (nearBottom.current) transcript.current?.scrollToEnd({ animated: false });
              }}
              onLayout={() => {
                if (nearBottom.current) transcript.current?.scrollToEnd({ animated: false });
              }}
              contentContainerStyle={{ flexGrow: 1, gap: spacing.md, paddingVertical: spacing.sm }}
            >
              <View key="older-messages">
                {query.hasNextPage && (
                  <FinanceRow
                    title={query.isFetchingNextPage ? "Loading…" : "Load older messages"}
                    onPress={
                      query.isFetchingNextPage ? undefined : () => void query.fetchNextPage()
                    }
                  />
                )}
              </View>
              {messages.map((message) => {
                const mine = message.authorKind === "user";
                return (
                  <View
                    key={message.id}
                    style={{
                      alignSelf: mine ? "flex-end" : "flex-start",
                      maxWidth: "88%",
                      gap: spacing.xs,
                    }}
                  >
                    <Text
                      style={{
                        color: t.secondary,
                        fontSize: 12,
                        textAlign: mine ? "right" : "left",
                      }}
                    >
                      {mine ? "You" : "nohmi"} ·{" "}
                      {new Date(message.createdAt).toLocaleString(undefined, {
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </Text>
                    <View
                      style={{
                        padding: spacing.md,
                        borderRadius: radius.panel,
                        backgroundColor: mine ? (t.dark ? "#173b2a" : "#e4f1e8") : t.surface,
                      }}
                    >
                      <Text selectable style={{ color: t.ink, fontSize: 16, lineHeight: 23 }}>
                        {mine ? message.text : agentMessageText(message.text)}
                      </Text>
                      {message.recordRefs?.map((ref) => {
                        // Reference kinds this client cannot open yet are omitted.
                        if (!(ref.kind in referenceLabels)) return null;
                        return (
                          <FinanceRow
                            key={`${ref.kind}:${ref.id}${ref.kind === "budget_plan" ? `:${ref.budgetVersionId}` : ""}`}
                            title={
                              ref.kind === "account" && ref.displayLabel
                                ? ref.displayLabel
                                : referenceLabels[ref.kind as keyof typeof referenceLabels]
                            }
                            onPress={() => {
                              if (ref.kind === "transaction" || ref.kind === "account") {
                                router.push({
                                  pathname:
                                    ref.kind === "transaction"
                                      ? "/finance-transaction"
                                      : "/finance-account",
                                  params: { id: ref.id },
                                });
                                return;
                              }
                              router.push({
                                pathname: "/finance-chat-reference",
                                params: {
                                  kind: ref.kind,
                                  id: ref.id,
                                  ...(ref.kind === "budget_plan"
                                    ? { versionId: ref.budgetVersionId }
                                    : {}),
                                },
                              });
                            }}
                          />
                        );
                      })}
                    </View>
                  </View>
                );
              })}
              {!messages.length && (
                <Copy secondary>Your Finance conversation will appear here.</Copy>
              )}
            </ScrollView>
          </ReadState>
        </View>
        <View
          style={{
            paddingTop: spacing.sm,
            paddingBottom: spacing.sm,
            borderTopWidth: 1,
            borderTopColor: t.line,
          }}
        >
          <ConversationComposer />
        </View>
      </View>
    </View>
  );
}
