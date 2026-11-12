import type {
  FinanceReviewBacklogAssessment,
  FinanceReviewBacklogGroup,
  FinanceReviewBacklogItem,
} from "@personal-os/domain";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "@/api";
import { DataViewEmpty, DataViewLoading, DataViewRecovery } from "@/components/data-view-state";
import { Field, FieldLabel } from "@/components/settings-field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Item, ItemContent, ItemDescription, ItemGroup, ItemTitle } from "@/components/ui/item";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { FinanceAttentionSummary } from "./attention-summary";
import { FinanceSection } from "./finance-section";
import { formatMoney } from "./format";

const assessmentKey = ["finance-review-backlog"];
const batchesKey = ["finance-review-batches"];
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
      {assessment.data?.attention ? (
        <FinanceAttentionSummary snapshot={assessment.data.attention} />
      ) : null}
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
            ? `${transaction.date ?? "Undated"} · ${!transaction.currencyCode || transaction.currencyCode === "USD" ? formatMoney(transaction.amountCents / 100) : `${transaction.currencyCode} ${(transaction.amountCents / 100).toFixed(2)}`} · ${transaction.direction} · ${transaction.pending ? "Pending" : "Posted"}`
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
  return (
    <Link
      className="text-sm underline underline-offset-4"
      to={`/finances/chat?batch=${encodeURIComponent(id)}`}
    >
      Review batch in Finance Chat
    </Link>
  );
}
