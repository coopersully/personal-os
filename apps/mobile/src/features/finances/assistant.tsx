import { useInfiniteQuery } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { FinanceAttentionSummary } from "./attention-summary";
import { Conversation } from "./conversation";
import { useFinance, useFinanceRead } from "./data";
import { financeLabel } from "./presentation";
import { Card, Copy, FinanceRow, FinanceScreen, ReadState, Segments } from "./ui";

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
              title={financeLabel(entry.action)}
              subtitle={entry.explanation}
              value={financeLabel(entry.status)}
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
function Attention({ onDecisions }: { onDecisions: () => void }) {
  const query = useFinanceRead(["attention"], (api) => api.getFinanceAttention());
  return (
    <ReadState query={query}>
      {query.data ? (
        <FinanceAttentionSummary
          snapshot={query.data}
          onDecisions={onDecisions}
          onBudget={() => router.push({ pathname: "/finances/plan", params: { view: "Budget" } })}
          onOpening={() => router.push("/finance-opening-position")}
          onHistory={() => router.push("/finance-historical-cleanup")}
        />
      ) : null}
    </ReadState>
  );
}
export function FinanceAssistantScreen() {
  const { owner } = useFinance();
  const [mode, setMode] = useState<"For you" | "Conversation" | "Activity">("For you");
  const { view } = useLocalSearchParams<{ view?: string }>();
  useEffect(() => {
    if (view === "Activity" || view === "Conversation" || view === "For you") setMode(view);
  }, [view]);
  return (
    <FinanceScreen title="Assistant" scroll={mode !== "Conversation"}>
      <Segments
        value={mode}
        options={["For you", "Conversation", "Activity"]}
        onChange={(next) => {
          setMode(next);
          router.setParams({ view: next });
        }}
      />
      {mode === "Conversation" ? (
        <Conversation key={owner} />
      ) : mode === "Activity" ? (
        <Activity />
      ) : (
        <>
          <Attention
            onDecisions={() => {
              setMode("Conversation");
              router.setParams({ view: "Conversation" });
            }}
          />
          <Card>
            <FinanceRow
              title="Your Finance conversation"
              subtitle="Ask a question or continue your conversation"
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
