import { useInfiniteQuery } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { View } from "react-native";
import { categoryIcon } from "./category-presentation";
import { Conversation } from "./conversation";
import { useFinance, useFinanceRead } from "./data";
import { financeLabel, recordAmount } from "./presentation";
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
function Attention() {
  const query = useFinanceRead(["reviews"], (api) => api.getFinanceReviewQueue());
  return (
    <Section title="Needs your input">
      <ReadState query={query}>
        <View style={{ gap: 12 }}>
          {query.data?.length ? (
            query.data.map((review) => (
              <Card key={review.id}>
                <View style={{ flex: 1 }}>
                  <FinanceRow
                    title={review.transaction.merchant}
                    value={recordAmount(review.transaction.amount, review.transaction.currencyCode)}
                    subtitle={
                      review.transaction.category ??
                      review.suggestedCategory?.name ??
                      "Choose a category"
                    }
                    icon={categoryIcon(
                      review.transaction.category ??
                        review.suggestedCategory?.name ??
                        "Uncategorized",
                    )}
                    onPress={() =>
                      router.push({
                        pathname: "/finance-transaction",
                        params: { id: review.transaction.id },
                      })
                    }
                  />
                </View>
              </Card>
            ))
          ) : (
            <Copy secondary>No transaction reviews waiting.</Copy>
          )}
        </View>
      </ReadState>
    </Section>
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
          <Attention />
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
