import type {
  FinanceReviewBacklogAssessment,
  FinanceReviewBacklogGroup,
  FinanceReviewBacklogItem,
  FinanceReviewBatchRun,
} from "@personal-os/domain";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "@/api";
import { DataViewEmpty, DataViewLoading, DataViewRecovery } from "@/components/data-view-state";
import { Field, FieldLabel } from "@/components/settings-field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Item, ItemContent, ItemDescription, ItemGroup, ItemTitle } from "@/components/ui/item";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { useFeedbackMutation } from "@/lib/use-feedback-mutation";
import { FinanceSection } from "./finance-section";

const assessmentKey = ["finance-review-backlog"];
const batchesKey = ["finance-review-batches"];
const runKey = (id: string) => ["finance-review-batch", id];
const words = (value: string) => value.replaceAll("_", " ");

function Counts({ counts }: { counts: FinanceReviewBacklogAssessment["counts"] }) {
  return (
    <dl className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
      <div>
        <dt>Flagged transactions</dt>
        <dd>{counts.needsReviewTransactions}</dd>
      </div>
      <div>
        <dt>Open reviews</dt>
        <dd>{counts.openReviewCases}</dd>
      </div>
      <div>
        <dt>Deferred reviews</dt>
        <dd>{counts.deferredReviewCases}</dd>
      </div>
    </dl>
  );
}

export function FinanceReviewBacklog() {
  const assessment = useQuery({
    queryKey: assessmentKey,
    queryFn: () => api.getFinanceReviewBacklog(),
  });
  const [selectedGroup, setSelectedGroup] = useState<FinanceReviewBacklogGroup>();
  const group =
    selectedGroup ??
    assessment.data?.groups.find((item) => item.counts.items > 0)?.group ??
    "roundups";
  return (
    <div className="grid min-w-0 gap-6">
      <FinanceSection
        title="Review backlog"
        description="All dates. Transaction flags and review cases can refer to the same transaction."
      >
        <DataViewRecovery
          query={assessment}
          title="Could not load review backlog"
          unavailableLabel="Review backlog unavailable"
        />
        {assessment.isPending ? <DataViewLoading label="Loading review backlog" /> : null}
        {assessment.data ? (
          <>
            <Counts counts={assessment.data.counts} />
            <p className="text-sm text-muted-foreground">
              {assessment.data.counts.currentMonth} current-month records ·{" "}
              {assessment.data.counts.historical} historical · {assessment.data.counts.future}{" "}
              future · {assessment.data.counts.unknownDate} undated
            </p>
            {assessment.data.counts.items === 0 ? (
              <DataViewEmpty
                title="No outstanding review records"
                description="No flagged transactions or open or deferred review cases across all dates."
              />
            ) : (
              <>
                <Field>
                  <FieldLabel htmlFor="finance-backlog-group">Investigation group</FieldLabel>
                  <NativeSelect
                    id="finance-backlog-group"
                    value={group}
                    onChange={(event) =>
                      setSelectedGroup(event.target.value as FinanceReviewBacklogGroup)
                    }
                  >
                    {assessment.data.groups.map((item) => (
                      <NativeSelectOption key={item.group} value={item.group}>
                        {item.label} · {item.counts.needsReviewTransactions} flagged ·{" "}
                        {item.counts.openReviewCases} open · {item.counts.deferredReviewCases}{" "}
                        deferred
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </Field>
                <p className="text-sm text-muted-foreground">
                  {assessment.data.groups.find((item) => item.group === group)?.guidance}
                </p>
                <BacklogItems key={`${group}:${assessment.data.snapshot}`} group={group} />
              </>
            )}
          </>
        ) : null}
      </FinanceSection>
      <SavedBatches />
    </div>
  );
}

function BacklogItems({ group }: { group: FinanceReviewBacklogGroup }) {
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);
  const cursor = cursors.at(-1);
  const page = useQuery({
    queryKey: ["finance-review-backlog-items", group, cursor],
    queryFn: () => api.listFinanceReviewBacklogItems({ group, cursor, limit: 10 }),
  });
  return (
    <div className="grid gap-3">
      <DataViewRecovery
        query={page}
        title="Could not load group records"
        unavailableLabel="Group records unavailable"
      />
      {page.isPending ? <DataViewLoading label="Loading group records" /> : null}
      {page.data?.items.length === 0 ? (
        <DataViewEmpty
          title="No records in this group"
          description="Choose another investigation group to continue."
        />
      ) : null}
      <ItemGroup aria-label="Group records">
        {page.data?.items.map((item) => (
          <BacklogItem key={item.id} item={item} />
        ))}
      </ItemGroup>
      <div className="flex flex-wrap items-center gap-2">
        {cursors.length > 1 ? (
          <Button variant="outline" onClick={() => setCursors([undefined])}>
            First page
          </Button>
        ) : null}
        {cursors.length > 1 ? (
          <Button variant="outline" onClick={() => setCursors((values) => values.slice(0, -1))}>
            Previous records
          </Button>
        ) : null}
        {page.data?.nextCursor ? (
          <Button
            variant="outline"
            disabled={page.isFetching}
            onClick={() => setCursors((values) => [...values, page.data?.nextCursor ?? undefined])}
          >
            Next records
          </Button>
        ) : null}
        {page.data && page.data.total > 0 ? (
          <span className="text-sm text-muted-foreground">
            Page {cursors.length} · {page.data.total} records in this group
          </span>
        ) : null}
      </div>
    </div>
  );
}

function BacklogItem({ item }: { item: FinanceReviewBacklogItem }) {
  const transaction = item.transaction;
  return (
    <Item>
      <ItemContent className="min-w-0 break-words">
        <ItemTitle>
          <Link className="underline underline-offset-4" to={item.destination}>
            {transaction?.merchant ?? "Unavailable transaction"}
          </Link>
        </ItemTitle>
        <ItemDescription>
          {transaction
            ? `${transaction.date ?? "Undated"} · ${transaction.amountCents / 100} ${transaction.currencyCode ?? "currency unavailable"} · ${transaction.direction} · ${transaction.pending ? "Pending" : "Posted"}`
            : "Transaction source unavailable"}
        </ItemDescription>
        <div className="flex flex-wrap gap-2">
          <Badge variant="secondary">
            {item.source === "transaction_flag"
              ? "Transaction flag"
              : `${words(item.status)} review`}
          </Badge>
          <span className="text-sm">
            {words(item.reason)} · {words(item.period)}
          </span>
        </div>
        <p className="text-sm text-muted-foreground">
          {words(item.provenance.evidenceState)} · Evidence requires validation
        </p>
        {item.savedClarification ? (
          <p className="text-sm">
            Saved clarification: {item.savedClarification.text}
            {item.savedClarification.truncated ? "… (open evidence for the full note)" : ""}
          </p>
        ) : null}
        <ul className="list-inside list-disc text-sm">
          {[...new Set(item.evidence)].map((evidence) => (
            <li key={evidence}>{evidence}</li>
          ))}
        </ul>
        <Link
          className="text-sm underline underline-offset-4"
          to={`/finances/transactions?transactionId=${encodeURIComponent(item.transactionId)}`}
        >
          Transaction evidence
        </Link>
      </ItemContent>
    </Item>
  );
}

function SavedBatches() {
  const batches = useQuery({
    queryKey: batchesKey,
    queryFn: () => api.listFinanceReviewBatches({ limit: 50 }),
  });
  const [selectedId, setSelectedId] = useState("");
  return (
    <FinanceSection
      title="Saved review batches"
      description="Agents prepare exact decisions with evidence. Review a saved batch before processing its next ten decisions."
    >
      <DataViewRecovery
        query={batches}
        title="Could not load saved batches"
        unavailableLabel="Saved batches unavailable"
      />
      {batches.isPending ? <DataViewLoading label="Loading saved batches" /> : null}
      {batches.data?.length === 0 ? (
        <DataViewEmpty
          title="No prepared batches"
          description="Prepared decisions will appear here for review and authorization."
        />
      ) : null}
      {batches.data && batches.data.length > 0 ? (
        <>
          <Field>
            <FieldLabel htmlFor="finance-review-batch">Saved batch</FieldLabel>
            <NativeSelect
              id="finance-review-batch"
              value={selectedId}
              onChange={(event) => setSelectedId(event.target.value)}
            >
              <NativeSelectOption value="">Choose a batch</NativeSelectOption>
              {batches.data.map((run) => (
                <NativeSelectOption key={run.id} value={run.id}>
                  {new Date(run.createdAt).toLocaleString()} · {words(run.status)} ·{" "}
                  {run.pendingCount} pending · {run.decisions.length}{" "}
                  {run.decisions.length === 1 ? "decision" : "decisions"}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
          <p className="text-sm text-muted-foreground">
            Latest {batches.data.length} saved batches (up to 50).
          </p>
        </>
      ) : null}
      {selectedId ? <BatchPreview key={selectedId} id={selectedId} /> : null}
    </FinanceSection>
  );
}

function BatchPreview({ id }: { id: string }) {
  const client = useQueryClient();
  const run = useQuery({ queryKey: runKey(id), queryFn: () => api.getFinanceReviewBatch(id) });
  const categories = useQuery({
    queryKey: ["finance-categories"],
    queryFn: () => api.getFinanceCategories(),
    enabled: Boolean(run.data?.decisions.some((decision) => decision.categoryId)),
  });
  const missingCategory = run.data?.decisions.some(
    (decision) =>
      decision.categoryId &&
      !categories.data?.some((category) => category.id === decision.categoryId),
  );
  const execute = useFeedbackMutation({
    feedback: {
      action: "process this batch step",
      pending: "Processing up to ten decisions…",
      success: "Batch step recorded. Review the saved outcomes.",
      safeToRetry: false,
    },
    mutationFn: (manifest: FinanceReviewBatchRun) =>
      api.executeFinanceReviewBatch(manifest.id, { fingerprint: manifest.fingerprint, limit: 10 }),
    onSuccess: (result) => {
      client.setQueryData(runKey(id), result);
    },
    // Even a lost response can follow committed items. Reload durable state before offering resume.
    onSettled: async () => {
      await client.invalidateQueries({
        predicate: (query) =>
          typeof query.queryKey[0] === "string" && query.queryKey[0].startsWith("finance-"),
      });
    },
  });
  const record = run.data;
  return (
    <div className="grid min-w-0 gap-3">
      <DataViewRecovery
        query={run}
        title="Could not load batch decisions"
        unavailableLabel="Batch decisions unavailable"
      />
      {run.isPending ? <DataViewLoading label="Loading batch decisions" /> : null}
      <DataViewRecovery
        query={categories}
        title="Could not load categories"
        unavailableLabel="Categories unavailable"
      />
      {record ? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">{words(record.status)}</Badge>
            <span className="text-sm">
              {record.pendingCount} pending · {record.outcomes.length} recorded outcomes
            </span>
          </div>
          <ItemGroup aria-label="Exact batch decisions">
            {record.decisions.map((decision, index) => {
              const outcome = record.outcomes.find((item) => item.index === index);
              return (
                <Item key={decision.transactionId}>
                  <ItemContent className="min-w-0 break-words">
                    <ItemTitle>
                      {index + 1}.{" "}
                      {decision.kind === "categorization"
                        ? "Categorize transaction"
                        : words(decision.action)}
                    </ItemTitle>
                    <Link
                      className="text-sm underline underline-offset-4"
                      to={`/finances/transactions?transactionId=${encodeURIComponent(decision.transactionId)}`}
                    >
                      <BatchTransactionName id={decision.transactionId} />
                    </Link>
                    {decision.kind === "review" ? (
                      <Link
                        className="text-sm underline underline-offset-4"
                        to={`/finances?review=${encodeURIComponent(`finance-review:${decision.reviewId}`)}`}
                      >
                        Open exact review
                      </Link>
                    ) : null}
                    {decision.categoryId ? (
                      <p className="text-sm">
                        Category:{" "}
                        {categories.data?.find((category) => category.id === decision.categoryId)
                          ?.name ??
                          (categories.isPending
                            ? "Loading category…"
                            : "Unavailable — prepare a new preview")}
                      </p>
                    ) : null}
                    {decision.kind === "review" && decision.nonTransferDirection ? (
                      <p className="text-sm">Direction: {decision.nonTransferDirection}</p>
                    ) : null}
                    <p className="text-sm">{decision.rationale}</p>
                    <p className="text-sm">Evidence: {decision.evidence}</p>
                    <p className="text-sm text-muted-foreground">
                      Agent confidence: {decision.confidence} · Merchant learning:{" "}
                      {decision.learnMerchant}
                    </p>
                    <details>
                      <summary className="text-sm">Decision technical details</summary>
                      <div className="grid gap-1 break-all text-xs">
                        <p>Transaction: {decision.transactionId}</p>
                        {decision.kind === "review" ? (
                          <p>
                            Review: {decision.reviewId} · Revision:{" "}
                            {decision.expectedReviewUpdatedAt}
                          </p>
                        ) : null}
                        {decision.categoryId ? <p>Category: {decision.categoryId}</p> : null}
                        <p>Transaction revision: {decision.expectedTransactionUpdatedAt}</p>
                      </div>
                    </details>
                    <Badge variant="secondary">{outcome ? words(outcome.status) : "Pending"}</Badge>
                    {outcome?.error ? (
                      <p className="text-sm">
                        {outcome.error.message} ({outcome.error.code})
                      </p>
                    ) : null}
                    {outcome?.recovery === "new_preview" ? (
                      <p className="text-sm">Needs a new preview with corrected evidence.</p>
                    ) : null}
                  </ItemContent>
                </Item>
              );
            })}
          </ItemGroup>
          <details>
            <summary className="text-sm">Batch technical details</summary>
            <p className="break-all text-xs">Batch: {record.id}</p>
            <p className="break-all text-xs">{record.fingerprint}</p>
          </details>
          {record.pendingCount > 0 ? (
            <Button
              className="justify-self-start"
              disabled={execute.isPending || run.isFetching || run.isError || missingCategory}
              onClick={() => execute.mutate(record)}
            >
              {record.outcomes.length ? "Resume" : "Process"}{" "}
              {record.pendingCount > 10
                ? "next 10"
                : `${record.pendingCount} ${record.pendingCount === 1 ? "decision" : "decisions"}`}
            </Button>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function BatchTransactionName({ id }: { id: string }) {
  const transaction = useQuery({
    queryKey: ["finance-transaction", id],
    queryFn: () => api.getFinanceTransaction(id),
  });
  return <>{transaction.data?.data?.merchant ?? "Open transaction evidence"}</>;
}
