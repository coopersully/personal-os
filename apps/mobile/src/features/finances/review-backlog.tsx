import { ApiClientError } from "@personal-os/api-client";
import type { FinanceReviewBacklogGroup } from "@personal-os/domain";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { router, Stack } from "expo-router";
import { useRef, useState } from "react";
import { toast } from "sonner-native";
import { useFinance, useFinanceRead } from "./data";
import { financeLabel, formatLocalDate, formatMoney } from "./presentation";
import { Card, Copy, FinanceRow, FinanceScreen, ReadState, Section } from "./ui";

const openTransaction = (id: string) =>
  router.push({ pathname: "/finance-transaction", params: { id } });

/**
 * One more page of a list already on screen. A failure leaves the loaded rows in place and
 * is reported once; `restart` handles a list the server says changed underneath the cursor.
 */
function useLoadMore(
  query: { fetchNextPage: () => Promise<{ isError: boolean; error: unknown }> },
  failure: string,
  restart?: () => void,
) {
  const busy = useRef(false);
  return async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      const result = await query.fetchNextPage();
      if (!result.isError) return;
      if (restart && result.error instanceof ApiClientError && result.error.status === 409)
        restart();
      else toast.error(failure);
    } finally {
      busy.current = false;
    }
  };
}
/** A failed further page is this screen's to report; the first page stays ReadState's. */
const firstPage = <T extends { isError: boolean; isFetchNextPageError: boolean }>(query: T) => ({
  ...query,
  isError: query.isError && !query.isFetchNextPageError,
});

/** Everything still flagged or under review, by group. Records are worked on their transaction. */
export function ReviewBacklog() {
  const assessment = useFinanceRead(["review-backlog"], (api) => api.getFinanceReviewBacklog());
  const [chosen, setChosen] = useState<FinanceReviewBacklogGroup | null>(null);
  const groups = assessment.data?.groups ?? [];
  const group =
    chosen ?? groups.find((entry) => entry.counts.items > 0)?.group ?? groups[0]?.group ?? null;
  const counts = assessment.data?.counts;
  return (
    <FinanceScreen title="Review backlog">
      <Stack.Screen options={{ title: "review backlog" }} />
      <ReadState query={assessment}>
        {counts ? (
          <>
            <Card rows>
              <FinanceRow
                centered
                title="Flagged transactions"
                value={String(counts.needsReviewTransactions)}
                icon="attention"
              />
              <FinanceRow
                centered
                title="Open reviews"
                value={String(counts.openReviewCases)}
                icon="history"
              />
              <FinanceRow
                centered
                title="Deferred reviews"
                value={String(counts.deferredReviewCases)}
                icon="clock"
              />
            </Card>
            <Copy secondary>
              All dates. A flag and a review can refer to the same transaction, so these counts are
              not added together.
            </Copy>
            <Section title="Groups">
              <Card rows>
                {groups.map((entry) => (
                  <FinanceRow
                    key={entry.group}
                    centered
                    title={entry.label}
                    subtitle={entry.group === group ? "Showing" : undefined}
                    value={String(entry.counts.items)}
                    icon="grid"
                    onPress={() => setChosen(entry.group)}
                  />
                ))}
              </Card>
            </Section>
            {group && (
              <BacklogRecords
                key={group}
                group={group}
                guidance={groups.find((entry) => entry.group === group)?.guidance}
              />
            )}
          </>
        ) : (
          <Copy secondary>The review backlog is unavailable.</Copy>
        )}
      </ReadState>
    </FinanceScreen>
  );
}

function BacklogRecords({
  group,
  guidance,
}: {
  group: FinanceReviewBacklogGroup;
  guidance: string | undefined;
}) {
  const { api, owner } = useFinance();
  const client = useQueryClient();
  const queryKey = ["finances", owner, "review-backlog-items", group];
  const query = useInfiniteQuery({
    meta: { scopedReadFeedback: true },
    queryKey,
    enabled: !!owner,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      api.listFinanceReviewBacklogItems({ group, cursor: pageParam, limit: 25 }),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
  const more = useLoadMore(query, "Couldn’t load more records.", () => {
    // Pages belong to one snapshot of the backlog; a changed backlog is read again whole.
    toast.error("The backlog changed while you were reading it. Showing it again from the start.");
    void client.resetQueries({ queryKey: ["finances", owner, "review-backlog"] });
    void client.resetQueries({ queryKey });
  });
  const rows = query.data?.pages.flatMap((page) => page.items) ?? [];
  return (
    <Section title="Records">
      {guidance ? <Copy secondary>{guidance}</Copy> : null}
      <ReadState query={{ ...firstPage(query), feedbackKey: JSON.stringify(queryKey) }}>
        <Card rows>
          {rows.length ? (
            rows.map((item) => (
              <FinanceRow
                key={item.id}
                title={item.transaction?.merchant ?? "Transaction unavailable"}
                subtitle={[
                  financeLabel(item.reason),
                  item.source === "transaction_flag"
                    ? "Transaction flag"
                    : `${financeLabel(item.status)} review`,
                  item.transaction?.date ? formatLocalDate(item.transaction.date) : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
                value={
                  item.transaction
                    ? formatMoney(item.transaction.amountCents / 100, item.transaction.currencyCode)
                    : undefined
                }
                icon="receipt"
                onPress={item.transaction ? () => openTransaction(item.transactionId) : undefined}
              />
            ))
          ) : (
            <Copy secondary>No outstanding review records in this group.</Copy>
          )}
          {query.hasNextPage && (
            <FinanceRow
              title={query.isFetchingNextPage ? "Loading…" : "Load more records"}
              onPress={query.isFetchingNextPage ? undefined : () => void more()}
            />
          )}
        </Card>
      </ReadState>
    </Section>
  );
}

/** Reviews that were resolved or set aside, newest first. */
export function ReviewHistory() {
  const { api, owner } = useFinance();
  const queryKey = ["finances", owner, "review-history"];
  const query = useInfiniteQuery({
    meta: { scopedReadFeedback: true },
    queryKey,
    enabled: !!owner,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      api.listFinanceReviewHistory({ ...(pageParam ? { cursor: pageParam } : {}), limit: 20 }),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
  const more = useLoadMore(query, "Couldn’t load more history.");
  const rows = query.data?.pages.flatMap((page) => page.items) ?? [];
  return (
    <FinanceScreen title="Review history">
      <Stack.Screen options={{ title: "review history" }} />
      <ReadState query={{ ...firstPage(query), feedbackKey: JSON.stringify(queryKey) }}>
        <Card rows>
          {rows.length ? (
            rows.map((item) => (
              <FinanceRow
                key={item.id}
                title={item.context?.merchant ?? financeLabel(item.reason)}
                subtitle={[
                  financeLabel(item.reason),
                  formatLocalDate((item.resolvedAt ?? item.firstSeenAt).slice(0, 10)),
                  item.archived ? "Source removed" : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
                value={financeLabel(item.status)}
                icon="history"
                onPress={() =>
                  router.push({
                    pathname: "/finance-reviews",
                    params: { view: "history-item", id: item.id },
                  })
                }
              />
            ))
          ) : (
            <Copy secondary>No review history yet.</Copy>
          )}
          {query.hasNextPage && (
            <FinanceRow
              title={query.isFetchingNextPage ? "Loading…" : "Load more history"}
              onPress={query.isFetchingNextPage ? undefined : () => void more()}
            />
          )}
        </Card>
      </ReadState>
    </FinanceScreen>
  );
}

const outcomeLabels: Record<string, string> = {
  confirm_classification: "Category confirmed",
  classify_transaction: "Category chosen",
  link_transactions: "Transactions linked",
  update_profile: "Profile updated",
  dismiss: "Dismissed",
  clarify: "Clarified",
};
const text = (value: unknown) => (typeof value === "string" && value.trim() ? value : null);

/** The recorded context and outcome of one review, kept as read-only history. */
export function ReviewHistoryItem({ id }: { id: string }) {
  const query = useFinanceRead(["review-history-item", id], (api) =>
    api.getFinanceReviewHistoryItem(id),
  );
  const item = query.data;
  const resolution = item?.resolution as Record<string, unknown> | null | undefined;
  const note = text(resolution?.rationale) ?? text(resolution?.clarification);
  const actor = item?.resolutionProvenance?.actorType;
  const transactionId = item?.transactionId;
  return (
    <FinanceScreen title="Review evidence">
      <Stack.Screen options={{ title: "review evidence" }} />
      <ReadState query={query}>
        {item ? (
          <>
            <Copy>{item.prompt ?? financeLabel(item.reason)}</Copy>
            {item.archived ? (
              <Copy secondary>Source removed. This review is retained as read-only history.</Copy>
            ) : null}
            <Card rows>
              <FinanceRow
                centered
                title="Status"
                value={financeLabel(item.status)}
                icon="history"
              />
              <FinanceRow
                centered
                title="First seen"
                value={new Date(item.firstSeenAt).toLocaleDateString()}
                icon="calendar"
              />
              {item.resolvedAt ? (
                <FinanceRow
                  centered
                  title="Resolved"
                  value={new Date(item.resolvedAt).toLocaleDateString()}
                  icon="calendar"
                />
              ) : null}
              {item.context ? (
                <FinanceRow
                  centered
                  title={item.context.merchant}
                  subtitle={item.context.date ? formatLocalDate(item.context.date) : undefined}
                  value={
                    typeof item.context.amount === "number"
                      ? formatMoney(item.context.amount, item.context.currencyCode)
                      : undefined
                  }
                  icon="receipt"
                />
              ) : null}
              {transactionId && !item.archived && item.relatedTransactionAvailable !== false ? (
                <FinanceRow
                  title="Open transaction"
                  onPress={() => openTransaction(transactionId)}
                />
              ) : null}
            </Card>
            {resolution ? (
              <Section title="Recorded outcome">
                <Card>
                  <Copy>
                    {outcomeLabels[String(resolution.type)] ??
                      financeLabel(String(resolution.type))}
                  </Copy>
                  {note ? <Copy secondary>{note}</Copy> : null}
                  {actor === "user" || actor === "agent" ? (
                    <Copy secondary>
                      {actor === "user" ? "Recorded by you" : "Recorded by an agent"}
                    </Copy>
                  ) : null}
                </Card>
              </Section>
            ) : null}
            {item.retainedQuestions?.length || item.retainedAnswers?.length ? (
              <Section title="Questions and answers">
                <Card>
                  {item.retainedQuestions?.map((question) => (
                    <Copy key={question.id} secondary>
                      {question.prompt}
                    </Copy>
                  ))}
                  {item.retainedAnswers?.map((answer) => (
                    <Copy key={answer.id}>{answer.text}</Copy>
                  ))}
                </Card>
              </Section>
            ) : null}
          </>
        ) : (
          <Copy secondary>This review is unavailable.</Copy>
        )}
      </ReadState>
    </FinanceScreen>
  );
}
