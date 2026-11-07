import { useInfiniteQuery } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { useFinance, useFinanceRead } from "./data";
import { Card, Copy, FinanceRow, FinanceScreen, ReadState, Section, Segments } from "./ui";

function Activity() {
  const { api, owner } = useFinance();
  const query = useInfiniteQuery({
    meta: { scopedReadFeedback: true },
    queryKey: ["finances", owner, "activity"],
    enabled: !!owner,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => api.listFinanceActivity({ cursor: pageParam, limit: 25 }),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
  const rows = query.data?.pages.flatMap((page) => page.entries) ?? [];
  return (
    <ReadState query={{ ...query, feedbackKey: JSON.stringify(["finances", owner, "activity"]) }}>
      <Card>
        {rows.length ? (
          rows.map((entry) => (
            <FinanceRow
              key={entry.id}
              title={entry.action}
              subtitle={entry.explanation}
              value={entry.status}
              icon="history"
            />
          ))
        ) : (
          <Copy secondary>No recorded activity yet.</Copy>
        )}
        {query.hasNextPage && (
          <FinanceRow
            title={query.isFetchingNextPage ? "Loading…" : "Load more activity"}
            onPress={query.isFetchingNextPage ? undefined : () => void query.fetchNextPage()}
          />
        )}
      </Card>
    </ReadState>
  );
}
function Conversation() {
  const { api, owner } = useFinance();
  const query = useInfiniteQuery({
    meta: { scopedReadFeedback: true },
    queryKey: ["finances", owner, "conversation"],
    enabled: !!owner,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => api.getFinanceConversationHistory({ after: pageParam, limit: 50 }),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
  const messages = query.data?.pages.flatMap((page) => page.messages) ?? [];
  return (
    <ReadState
      query={{ ...query, feedbackKey: JSON.stringify(["finances", owner, "conversation"]) }}
    >
      {messages.length ? (
        messages.map((message) => (
          <Card key={message.id}>
            <Copy secondary>
              {message.authorKind === "user" ? "You" : "nohmi"} ·{" "}
              {new Date(message.createdAt).toLocaleDateString()}
            </Copy>
            <Copy>{message.text}</Copy>
          </Card>
        ))
      ) : (
        <Card>
          <Copy secondary>Your Finance conversation will appear here.</Copy>
        </Card>
      )}
      {query.hasNextPage && (
        <FinanceRow
          title={query.isFetchingNextPage ? "Loading…" : "Load more messages"}
          onPress={query.isFetchingNextPage ? undefined : () => void query.fetchNextPage()}
        />
      )}
    </ReadState>
  );
}
function Attention() {
  const query = useFinanceRead(["reviews"], (api) => api.getFinanceReviewQueue());
  return (
    <Section title="Needs your input">
      <ReadState query={query}>
        <Card>
          {query.data?.length ? (
            query.data.map((review) => (
              <FinanceRow
                key={review.id}
                title={review.transaction.merchant}
                subtitle={review.rationale ?? review.reason.replaceAll("_", " ")}
                icon="attention"
                onPress={() =>
                  router.push({
                    pathname: "/finance-transaction",
                    params: { id: review.transaction.id },
                  })
                }
              />
            ))
          ) : (
            <Copy secondary>No transaction reviews waiting.</Copy>
          )}
        </Card>
      </ReadState>
    </Section>
  );
}
export function FinanceAssistantScreen() {
  const [mode, setMode] = useState<"For you" | "Conversation" | "Activity">("For you");
  const { view } = useLocalSearchParams<{ view?: string }>();
  useEffect(() => {
    if (view === "Activity" || view === "Conversation" || view === "For you") setMode(view);
  }, [view]);
  return (
    <FinanceScreen title="Assistant">
      <Segments
        value={mode}
        options={["For you", "Conversation", "Activity"]}
        onChange={(next) => {
          setMode(next);
          router.setParams({ view: next });
        }}
      />
      {mode === "Conversation" ? (
        <Conversation />
      ) : mode === "Activity" ? (
        <Activity />
      ) : (
        <>
          <Attention />
          <Card>
            <FinanceRow
              title="Your Finance conversation"
              subtitle="Read your ongoing Finance conversation"
              icon="mail"
              onPress={() => {
                setMode("Conversation");
                router.setParams({ view: "Conversation" });
              }}
            />
            <FinanceRow
              title="Recorded activity"
              subtitle="Actions, explanations, and outcomes"
              icon="history"
              onPress={() => {
                setMode("Activity");
                router.setParams({ view: "Activity" });
              }}
            />
          </Card>
        </>
      )}
    </FinanceScreen>
  );
}
