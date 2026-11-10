import { useInfiniteQuery } from "@tanstack/react-query";
import { router, useFocusEffect } from "expo-router";
import { type ComponentRef, useCallback, useEffect, useRef, useState } from "react";
import { AppState, Keyboard, Platform, ScrollView, Text, View } from "react-native";
import { radius, spacing, useTheme } from "../../theme";
import { ConversationComposer } from "./conversation-composer";
import { useFinance } from "./data";
import { Copy, FinanceRow, ReadState } from "./ui";

/** The transcript scrolls independently; composer and page controls never join its content. */
export function Conversation() {
  const { api, owner } = useFinance();
  const t = useTheme();
  const frame = useRef<ComponentRef<typeof View>>(null);
  const transcript = useRef<ComponentRef<typeof ScrollView>>(null);
  const nearBottom = useRef(true);
  const [keyboardInset, setKeyboardInset] = useState(0);
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
      const poll = () => {
        if (active) void refresh();
      };
      const timer = setInterval(poll, 5_000);
      const listener = AppState.addEventListener("change", (state) => {
        active = state === "active";
        if (active) poll();
      });
      return () => {
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
              onScroll={({ nativeEvent: { contentOffset, layoutMeasurement, contentSize } }) => {
                nearBottom.current =
                  contentSize.height - layoutMeasurement.height - contentOffset.y < 80;
              }}
              onContentSizeChange={() => {
                if (nearBottom.current) transcript.current?.scrollToEnd({ animated: false });
              }}
              onLayout={() => {
                if (nearBottom.current) transcript.current?.scrollToEnd({ animated: false });
              }}
              contentContainerStyle={{ flexGrow: 1, gap: spacing.md, paddingVertical: spacing.sm }}
            >
              {query.hasNextPage && (
                <FinanceRow
                  title={query.isFetchingNextPage ? "Loading…" : "Load older messages"}
                  onPress={query.isFetchingNextPage ? undefined : () => void query.fetchNextPage()}
                />
              )}
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
                      {message.recordRefs
                        ?.filter((ref) => ref.kind === "transaction")
                        .map((ref) => (
                          <FinanceRow
                            key={ref.id}
                            title="Attached transaction"
                            icon="receipt"
                            onPress={() =>
                              router.push({
                                pathname: "/finance-transaction",
                                params: { id: ref.id },
                              })
                            }
                          />
                        ))}
                      <Text selectable style={{ color: t.ink, fontSize: 16, lineHeight: 23 }}>
                        {message.text}
                      </Text>
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
