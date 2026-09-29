import type { FinanceAccount, FinanceCategory, FinanceTransaction } from "@personal-os/domain";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import {
  WorkspaceSecondaryAppBar,
  WorkspaceSecondaryAppBarActions,
} from "@/components/workspace-secondary-app-bar";
import { api } from "../../api.js";
import { InlineError } from "../../components/async-state.js";
import { formatMoney } from "./format.js";
import { requireFinanceResult } from "./position-material.js";

export function FinanceTransactionControls({
  accounts,
  categories,
  onAdd,
}: {
  accounts: FinanceAccount[];
  categories: FinanceCategory[];
  onAdd: () => void;
}) {
  const [params, setParams] = useSearchParams();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const activeFilters =
    ["accountId", "categoryId", "from", "to", "pending"].filter((key) => params.get(key)).length +
    (params.get("review") && params.get("review") !== "all" ? 1 : 0);
  return (
    <>
      <WorkspaceSecondaryAppBar aria-label="Transaction controls">
        <WorkspaceSecondaryAppBarActions>
          <Button asChild size="sm" variant="outline">
            <Link to="/finances/imports">Import history</Link>
          </Button>
          <Button onClick={onAdd} size="sm">
            New transaction
          </Button>
        </WorkspaceSecondaryAppBarActions>
      </WorkspaceSecondaryAppBar>
      <form
        aria-label="Filter transactions"
        key={params.toString()}
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          const next = new URLSearchParams(params);
          for (const key of [
            "search",
            "accountId",
            "categoryId",
            "from",
            "to",
            "pending",
            "review",
          ]) {
            const value = String(form.get(key) ?? "").trim();
            if (value) next.set(key, value);
            else next.delete(key);
          }
          next.delete("transactionId");
          setParams(next);
        }}
      >
        <Collapsible open={filtersOpen} onOpenChange={setFiltersOpen}>
          <FieldGroup className="grid min-w-0 gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
            <Field>
              <FieldLabel htmlFor="transaction-search">Search</FieldLabel>
              <Input
                id="transaction-search"
                name="search"
                maxLength={160}
                defaultValue={params.get("search") ?? ""}
                placeholder="Merchant or notes"
              />
            </Field>
            <div className="flex flex-wrap items-end gap-2">
              <Button type="submit" variant="outline">
                Apply filters
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setParams({});
                  setFiltersOpen(false);
                }}
              >
                Clear
              </Button>
              <CollapsibleTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  aria-label={activeFilters ? `Filters (${activeFilters} active)` : "Filters"}
                >
                  Filters
                  {activeFilters ? (
                    <Badge variant="secondary" aria-hidden="true">
                      {activeFilters}
                    </Badge>
                  ) : null}
                </Button>
              </CollapsibleTrigger>
            </div>
          </FieldGroup>
          {/* Mounted fields keep pending edits and are included in FormData while closed. */}
          <CollapsibleContent forceMount hidden={!filtersOpen} className="pt-3">
            <FieldGroup className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
              <Field>
                <FieldLabel htmlFor="transaction-account">Account</FieldLabel>
                <NativeSelect
                  id="transaction-account"
                  name="accountId"
                  defaultValue={params.get("accountId") ?? ""}
                >
                  <NativeSelectOption value="">All accounts</NativeSelectOption>
                  {accounts.map((account) => (
                    <NativeSelectOption key={account.id} value={account.id}>
                      {account.name}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </Field>
              <Field>
                <FieldLabel htmlFor="transaction-category">Category</FieldLabel>
                <NativeSelect
                  id="transaction-category"
                  name="categoryId"
                  defaultValue={params.get("categoryId") ?? ""}
                >
                  <NativeSelectOption value="">All categories</NativeSelectOption>
                  {categories.map((category) => (
                    <NativeSelectOption key={category.id} value={category.id}>
                      {category.name}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </Field>
              <Field>
                <FieldLabel htmlFor="transaction-review">Review</FieldLabel>
                <NativeSelect
                  id="transaction-review"
                  name="review"
                  defaultValue={params.get("review") ?? "all"}
                >
                  <NativeSelectOption value="all">All review states</NativeSelectOption>
                  <NativeSelectOption value="needs_review">Needs review</NativeSelectOption>
                  <NativeSelectOption value="resolved">Reviewed</NativeSelectOption>
                </NativeSelect>
              </Field>
              <Field>
                <FieldLabel htmlFor="transaction-from">From</FieldLabel>
                <Input
                  id="transaction-from"
                  name="from"
                  type="date"
                  defaultValue={params.get("from") ?? ""}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="transaction-to">Through</FieldLabel>
                <Input
                  id="transaction-to"
                  name="to"
                  type="date"
                  defaultValue={params.get("to") ?? ""}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="transaction-posted">Posting state</FieldLabel>
                <NativeSelect
                  id="transaction-posted"
                  name="pending"
                  defaultValue={params.get("pending") ?? ""}
                >
                  <NativeSelectOption value="">Pending and posted</NativeSelectOption>
                  <NativeSelectOption value="pending">Pending</NativeSelectOption>
                  <NativeSelectOption value="posted">Posted</NativeSelectOption>
                </NativeSelect>
              </Field>
            </FieldGroup>
          </CollapsibleContent>
        </Collapsible>
      </form>
    </>
  );
}

export function FinanceLinkedTransaction({
  id,
  onBreakdown,
  onCategorize,
}: {
  id: string;
  onBreakdown: (transaction: FinanceTransaction) => void;
  onCategorize: (transaction: FinanceTransaction) => void;
}) {
  const transaction = useQuery({
    queryKey: ["finance-transaction", id],
    queryFn: async () => requireFinanceResult(await api.getFinanceTransaction(id)),
  });
  if (transaction.isPending) return <p role="status">Loading source transaction…</p>;
  if (transaction.isError)
    return (
      <div>
        <InlineError error={transaction.error} />
        <Button variant="outline" onClick={() => void transaction.refetch()}>
          Retry
        </Button>
      </div>
    );
  const item = transaction.data.data;
  return (
    <section aria-label="Source transaction" className="rounded-lg border p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm text-muted-foreground">Source transaction</p>
          <h2 className="font-medium">{item.merchant}</h2>
          <p>
            {formatMoney(item.amount)} · {item.date}
          </p>
        </div>
        <Badge variant="secondary">{item.pending ? "Pending" : "Posted"}</Badge>
      </div>
      <dl className="my-4 grid grid-cols-2 gap-3 text-sm">
        <div>
          <dt className="text-muted-foreground">Category</dt>
          <dd>{item.category ?? "Uncategorized"}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Direction</dt>
          <dd>{item.direction}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Evidence</dt>
          <dd>{item.categoryRationale ?? "No categorization rationale recorded."}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Notes</dt>
          <dd>{item.notes ?? "None"}</dd>
        </div>
      </dl>
      {item.rawMerchant && item.rawMerchant !== item.merchant ? (
        <p className="mb-3 text-sm text-muted-foreground">Reported merchant: {item.rawMerchant}</p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={() => onCategorize(item)}>
          Categorize
        </Button>
        <Button variant="outline" size="sm" onClick={() => onBreakdown(item)}>
          View breakdown
        </Button>
        <Button asChild variant="ghost" size="sm">
          <Link to="/finances/review">Back to review</Link>
        </Button>
      </div>
    </section>
  );
}
