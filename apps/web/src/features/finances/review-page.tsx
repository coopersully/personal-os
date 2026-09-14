import {
  type AnswerFinanceReviewInput,
  type FinanceInboxCase,
  type FinanceReviewResolution,
  type FinanceToolResult,
  financeReviewResolutionSchema,
  idSchema,
} from "@personal-os/domain";
import { EmptyState, Spinner } from "@personal-os/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { CircleCheckIcon } from "@/components/icons";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Item, ItemContent, ItemDescription, ItemGroup, ItemTitle } from "@/components/ui/item";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { api, errorMessage } from "../../api.js";
import { InlineError } from "../../components/async-state.js";
import { formatMoney } from "./format.js";
import { requireFinanceResult } from "./position-material.js";
import { FinanceAgentReviewQueue } from "./review-queue.js";

const inboxKey = ["finance-inbox"];
const resolutions = {
  classify_transaction: "Choose a category",
  link_transactions: "Link another transaction",
  clarify: "Leave a note for maintenance",
  dismiss: "Dismiss with a reason",
} as const;
type ResolutionType = keyof typeof resolutions;
type Relationship = Extract<FinanceReviewResolution, { type: "link_transactions" }>["relationship"];

function evidenceTransactionIds(review: FinanceInboxCase) {
  const evidence = review.evidence;
  const proposed = review.proposedResolution;
  const candidates: unknown[] = [
    review.transactionId,
    evidence.transactionId,
    evidence.relatedTransactionId,
    proposed?.relatedTransactionId,
    ...(Array.isArray(evidence.transactionIds) ? evidence.transactionIds : []),
  ];
  if (Array.isArray(evidence.sourceRefs)) {
    for (const ref of evidence.sourceRefs) {
      if (
        ref &&
        typeof ref === "object" &&
        "type" in ref &&
        ref.type === "finance_transaction" &&
        "id" in ref
      )
        candidates.push(ref.id);
    }
  }
  return [
    ...new Set(
      candidates.filter((candidate): candidate is string => idSchema.safeParse(candidate).success),
    ),
  ];
}

function TransactionEvidence({ id }: { id: string }) {
  const transaction = useQuery({
    queryKey: ["finance-transaction", id],
    queryFn: () => api.getFinanceTransaction(id),
  });
  const record = transaction.data?.data;
  return (
    <Item>
      <ItemContent>
        <ItemTitle>
          <Link
            className="underline underline-offset-4"
            to={`/finances/transactions?transactionId=${encodeURIComponent(id)}`}
          >
            {record?.merchant ?? "Open transaction"}
          </Link>
        </ItemTitle>
        {transaction.isPending ? <Spinner label="Loading transaction evidence" /> : null}
        {transaction.error ? <InlineError error={transaction.error} /> : null}
        {record ? (
          <ItemDescription>
            {record.date} ·{" "}
            {record.currencyCode
              ? new Intl.NumberFormat(undefined, {
                  style: "currency",
                  currency: record.currencyCode,
                }).format(record.amount)
              : `${record.amount} (currency unavailable)`}{" "}
            · {record.direction} · {record.pending ? "Pending" : "Posted"}
            {record.category ? ` · ${record.category}` : ""}
          </ItemDescription>
        ) : null}
      </ItemContent>
    </Item>
  );
}

export function FinanceReviewPage() {
  const queryClient = useQueryClient();
  const inbox = useQuery({
    queryKey: inboxKey,
    queryFn: async () => requireFinanceResult(await api.getFinanceInbox()),
  });
  const result = inbox.data;
  const question = result?.communication.nextQuestion;
  const [searchParams, setSearchParams] = useSearchParams();
  const review =
    result?.data.find((item) => item.id === searchParams.get("item")) ??
    result?.data.find((item) => item.id === question?.id) ??
    (!question
      ? result?.data.find(
          (item) =>
            item.resolution?.type === "clarify" || typeof item.evidence.clarification === "string",
        )
      : undefined);
  const [olderOpen, setOlderOpen] = useState(false);
  function acceptResponse(response: FinanceToolResult<FinanceInboxCase[]>) {
    queryClient.setQueryData(inboxKey, response);
    void queryClient.invalidateQueries({
      predicate: (query) =>
        typeof query.queryKey[0] === "string" &&
        query.queryKey[0].startsWith("finance-") &&
        query.queryKey[0] !== "finance-inbox",
    });
  }
  return (
    <section aria-label="Finance review" className="grid gap-4">
      {inbox.error ? (
        <>
          <InlineError error={inbox.error} />
          <Button onClick={() => void inbox.refetch()} variant="outline">
            Reload review
          </Button>
        </>
      ) : null}
      {inbox.isPending ? <Spinner label="Loading Finance Inbox" /> : null}
      {result?.communication.requiredDisclosures.map((disclosure) => (
        <Alert key={disclosure.message}>
          <AlertDescription>{disclosure.message}</AlertDescription>
        </Alert>
      ))}
      {result && result.data.length > 1 ? (
        <Field>
          <FieldLabel htmlFor="finance-inbox-item">Outstanding items</FieldLabel>
          <NativeSelect
            id="finance-inbox-item"
            value={review?.id ?? ""}
            onChange={(event) => setSearchParams({ item: event.target.value })}
          >
            {result.data.map((item) => (
              <NativeSelectOption key={item.id} value={item.id}>
                {item.context
                  ? `${item.context.date} · ${item.context.merchant} · ${item.context.amount}`
                  : (item.prompt ?? item.reason.replaceAll("_", " "))}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>
      ) : null}
      {review ? (
        <ReviewQuestion
          key={review.id}
          onResponse={acceptResponse}
          prompt={
            question && review.id === question.id
              ? question.prompt
              : (review.prompt ?? "What should we know about this item?")
          }
          review={review}
          headline={result?.communication.headline ?? ""}
        />
      ) : null}
      {result && !question && result.data.length === 0 ? (
        <EmptyState icon={<CircleCheckIcon />} title="No open Inbox questions">
          {result.communication.headline}
        </EmptyState>
      ) : null}
      {result && result.data.length > 0 && !review ? (
        <Alert>
          <AlertTitle>Review question unavailable</AlertTitle>
          <AlertDescription>
            The Inbox has work, but its current question and evidence could not be matched. Reload
            to request the current state.
          </AlertDescription>
          <Button onClick={() => void inbox.refetch()} variant="outline">
            Reload review
          </Button>
        </Alert>
      ) : null}
      <Collapsible onOpenChange={setOlderOpen} open={olderOpen}>
        <CollapsibleTrigger asChild>
          <Button variant="ghost">Older questions and approvals</Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="grid gap-4 pt-4">
          <Button asChild variant="outline" className="justify-self-start">
            <Link to="/finances/review/legacy">Earlier transaction reviews</Link>
          </Button>
          {olderOpen ? <FinanceAgentReviewQueue /> : null}
        </CollapsibleContent>
      </Collapsible>
    </section>
  );
}

export function ReviewQuestion({
  review,
  prompt,
  headline,
  onResponse,
}: {
  review: FinanceInboxCase;
  prompt: string;
  headline: string;
  onResponse: (result: FinanceToolResult<FinanceInboxCase[]>) => void;
}) {
  const parsedProposal = financeReviewResolutionSchema.safeParse(review.proposedResolution);
  const proposal = parsedProposal.success ? parsedProposal.data : null;
  const [resolutionType, setResolutionType] = useState<ResolutionType>("clarify");
  const [answer, setAnswer] = useState("");
  const [categoryId, setCategoryId] = useState(
    proposal && "categoryId" in proposal ? proposal.categoryId : "",
  );
  const [relatedTransactionId, setRelatedTransactionId] = useState(
    proposal?.type === "link_transactions" ? proposal.relatedTransactionId : "",
  );
  const [relationship, setRelationship] = useState<Relationship>(
    proposal?.type === "link_transactions" ? proposal.relationship : "transfer",
  );
  const [cursor, setCursor] = useState<string | undefined>();
  const requestKey = useRef({ signature: "", key: "" });
  const categories = useQuery({
    queryKey: ["finance-categories"],
    queryFn: () => api.getFinanceCategories(),
  });
  const related = useQuery({
    queryKey: ["finance-review-related", cursor],
    queryFn: () => api.listFinanceTransactions({ limit: 50, cursor }),
    enabled: resolutionType === "link_transactions",
  });
  const mutation = useMutation({
    mutationFn: (input: AnswerFinanceReviewInput) => api.answerFinanceReview(review.id, input),
    onError: (error) => {
      if (errorMessage(error).includes("previously failed; use a new idempotency key")) {
        requestKey.current = { signature: "", key: "" };
      }
    },
    onSuccess: (response) => {
      if (response.outcome === "failed") {
        requestKey.current = { signature: "", key: "" };
        return;
      }
      setAnswer("");
      requestKey.current = { signature: "", key: "" };
      onResponse(response);
    },
  });
  const evidenceIds = evidenceTransactionIds(review);
  const primaryId =
    typeof review.transactionId === "string"
      ? review.transactionId
      : typeof review.evidence.transactionId === "string"
        ? review.evidence.transactionId
        : null;
  const proposedCategory =
    proposal && "categoryId" in proposal
      ? categories.data?.find((category) => category.id === proposal.categoryId)
      : null;
  const missingSelection =
    (resolutionType === "classify_transaction" &&
      !categories.data?.some((category) => category.id === categoryId)) ||
    (resolutionType === "link_transactions" &&
      (!idSchema.safeParse(relatedTransactionId).success || relatedTransactionId === primaryId));
  const answerLimit = resolutionType === "classify_transaction" ? 500 : 1000;
  const invalidAnswer =
    (resolutionType !== "classify_transaction" && !answer.trim()) ||
    answer.trim().length > answerLimit;
  function submit() {
    if (mutation.isPending || invalidAnswer || missingSelection) return;
    const value =
      answer.trim() ||
      `Categorized as ${categories.data?.find((category) => category.id === categoryId)?.name}.`;
    let resolution: FinanceReviewResolution;
    if (resolutionType === "classify_transaction")
      resolution = { type: "classify_transaction", categoryId, meaning: value };
    else if (resolutionType === "link_transactions")
      resolution = { type: "link_transactions", relatedTransactionId, relationship };
    else if (resolutionType === "dismiss") resolution = { type: "dismiss", rationale: value };
    else resolution = { type: "clarify", clarification: value };
    const signature = JSON.stringify({ answer: value, resolution });
    if (signature !== requestKey.current.signature)
      requestKey.current = { signature, key: crypto.randomUUID() };
    mutation.mutate({ answer: value, resolution, idempotencyKey: requestKey.current.key });
  }
  return (
    <Card>
      <CardHeader>
        <CardDescription>{headline}</CardDescription>
        <CardTitle>
          <h2>{prompt}</h2>
        </CardTitle>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">{review.reason.replaceAll("_", " ")}</Badge>
          <span className="text-sm text-muted-foreground">
            {formatMoney(review.impactAmount)} impact · Seen{" "}
            {new Date(review.lastSeenAt).toLocaleDateString()}
          </span>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4">
        {review.context ? (
          <p className="text-sm">
            {review.context.date} · {review.context.institution} {review.context.accountName} ·{" "}
            {review.context.direction === "income"
              ? "Money in"
              : review.context.direction === "transfer"
                ? "Transfer"
                : "Money out"}{" "}
            · {review.context.pending ? "Pending" : "Posted"}
          </p>
        ) : null}
        {review.resolution?.type === "clarify" &&
        typeof review.resolution.clarification === "string" ? (
          <Alert>
            <AlertTitle>Note saved · awaiting maintenance</AlertTitle>
            <AlertDescription>{review.resolution.clarification}</AlertDescription>
          </Alert>
        ) : null}
        {(
          ["merchant", "date", "questionReason", "rationale", "summary", "clarification"] as const
        ).map((key) =>
          typeof review.evidence[key] === "string" ? (
            <p className="text-sm" key={key}>
              {review.evidence[key]}
            </p>
          ) : null,
        )}
        {evidenceIds.length ? (
          <ItemGroup aria-label="Transaction evidence">
            {evidenceIds.map((id) => (
              <TransactionEvidence id={id} key={id} />
            ))}
          </ItemGroup>
        ) : (
          <p className="text-sm text-muted-foreground">
            This review does not include an exact transaction link. The source details above are the
            available evidence.
          </p>
        )}
        {review.context ? (
          <NearbyActivity context={review.context} transactionId={primaryId} />
        ) : null}
        {proposedCategory ? (
          <p className="text-sm">Proposed category: {proposedCategory.name}</p>
        ) : null}
        {proposal?.type === "link_transactions" ? (
          <p className="text-sm">Proposed relationship: {proposal.relationship}</p>
        ) : null}
        {categories.error ? <InlineError error={categories.error} /> : null}
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="finance-review-resolution">Resolution</FieldLabel>
              <NativeSelect
                className="w-full min-w-0"
                id="finance-review-resolution"
                value={resolutionType}
                disabled={mutation.isPending}
                onChange={(event) => setResolutionType(event.target.value as ResolutionType)}
              >
                {Object.entries(resolutions).map(([value, label]) => (
                  <NativeSelectOption key={value} value={value}>
                    {label}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
            {resolutionType === "classify_transaction" ? (
              <Field>
                <FieldLabel htmlFor="finance-review-category">Category</FieldLabel>
                <NativeSelect
                  className="w-full min-w-0"
                  id="finance-review-category"
                  value={categoryId}
                  onChange={(event) => setCategoryId(event.target.value)}
                  disabled={mutation.isPending || categories.isPending}
                >
                  <NativeSelectOption value="">Choose category</NativeSelectOption>
                  {categories.data?.map((category) => (
                    <NativeSelectOption key={category.id} value={category.id}>
                      {category.name}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </Field>
            ) : null}
            {resolutionType === "link_transactions" ? (
              <>
                <Field>
                  <FieldLabel htmlFor="finance-review-relationship">Relationship</FieldLabel>
                  <NativeSelect
                    className="w-full min-w-0"
                    id="finance-review-relationship"
                    disabled={mutation.isPending}
                    value={relationship}
                    onChange={(event) => setRelationship(event.target.value as Relationship)}
                  >
                    {(
                      ["transfer", "reimbursement", "refund", "reversal", "duplicate"] as const
                    ).map((value) => (
                      <NativeSelectOption key={value} value={value}>
                        {value}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </Field>
                <Field>
                  <FieldLabel htmlFor="finance-review-related">Related transaction</FieldLabel>
                  <NativeSelect
                    className="w-full min-w-0"
                    id="finance-review-related"
                    disabled={mutation.isPending || related.isPending}
                    value={relatedTransactionId}
                    onChange={(event) => setRelatedTransactionId(event.target.value)}
                  >
                    <NativeSelectOption value="">Choose transaction</NativeSelectOption>
                    {relatedTransactionId &&
                    !related.data?.items.some((item) => item.id === relatedTransactionId) ? (
                      <NativeSelectOption value={relatedTransactionId}>
                        Selected transaction (see evidence)
                      </NativeSelectOption>
                    ) : null}
                    {related.data?.items
                      .filter((item) => item.id !== primaryId)
                      .map((item) => (
                        <NativeSelectOption key={item.id} value={item.id}>
                          {item.date} · {item.merchant} · {item.amount}{" "}
                          {item.currencyCode ?? "currency unavailable"}
                        </NativeSelectOption>
                      ))}
                  </NativeSelect>
                </Field>
                {related.error ? <InlineError error={related.error} /> : null}
                <div className="flex flex-wrap gap-2">
                  {cursor ? (
                    <Button type="button" variant="ghost" onClick={() => setCursor(undefined)}>
                      Latest transactions
                    </Button>
                  ) : null}
                  {related.data?.nextCursor ? (
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => setCursor(related.data?.nextCursor ?? undefined)}
                    >
                      Earlier transactions
                    </Button>
                  ) : null}
                </div>
                {relatedTransactionId && !evidenceIds.includes(relatedTransactionId) ? (
                  <ItemGroup>
                    <TransactionEvidence id={relatedTransactionId} />
                  </ItemGroup>
                ) : null}
              </>
            ) : null}
            <Field>
              <FieldLabel htmlFor="finance-review-answer">Your answer</FieldLabel>
              <Textarea
                id="finance-review-answer"
                value={answer}
                maxLength={answerLimit}
                disabled={mutation.isPending}
                onChange={(event) => setAnswer(event.target.value)}
                required={resolutionType !== "classify_transaction"}
              />
              {resolutionType === "classify_transaction" ? (
                <FieldDescription>A note is optional when choosing a category.</FieldDescription>
              ) : null}
              {resolutionType === "clarify" ? (
                <FieldDescription>
                  Your note stays with this item for the next maintenance pass. Choose a category or
                  link a transaction to apply a correction now.
                </FieldDescription>
              ) : null}
              {answer.trim().length > answerLimit ? (
                <FieldDescription>
                  Use {answerLimit} characters or fewer for this resolution.
                </FieldDescription>
              ) : null}
            </Field>
          </FieldGroup>
          {mutation.error ? (
            <Alert variant="destructive">
              <AlertTitle>Answer not saved</AlertTitle>
              <AlertDescription>{errorMessage(mutation.error)}</AlertDescription>
            </Alert>
          ) : null}
          {mutation.data?.outcome === "failed" ? (
            <Alert variant="destructive">
              <AlertTitle>Answer not saved</AlertTitle>
              <AlertDescription>{mutation.data.communication.headline}</AlertDescription>
            </Alert>
          ) : null}
          <Button
            className="justify-self-start"
            disabled={mutation.isPending || invalidAnswer || missingSelection}
            type="submit"
          >
            {mutation.isPending ? "Saving answer…" : "Save answer"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function NearbyActivity({
  context,
  transactionId,
}: {
  context: NonNullable<FinanceInboxCase["context"]>;
  transactionId: string | null;
}) {
  const [open, setOpen] = useState(false);
  const bounds = (offset: number) => {
    const day = new Date(`${context.date}T12:00:00Z`);
    day.setUTCDate(day.getUTCDate() + offset);
    return day.toISOString().slice(0, 10);
  };
  const from = bounds(-7);
  const to = bounds(7);
  const nearby = useQuery({
    queryKey: ["finance-review-nearby", context.accountId, from, to],
    queryFn: () =>
      api.listFinanceTransactions({ accountId: context.accountId, from, to, limit: 50 }),
    enabled: open,
  });
  const items = nearby.data?.items.filter((item) => item.id !== transactionId);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <Button type="button" variant="ghost">
          Nearby account activity
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="grid gap-2">
        <p className="text-sm text-muted-foreground">
          Same account · {from} through {to}. Nearby activity does not establish a relationship.
        </p>
        {nearby.isPending ? <Spinner label="Loading nearby activity" /> : null}
        {nearby.error ? <InlineError error={nearby.error} /> : null}
        <ItemGroup>
          {items?.map((item) => (
            <Item key={item.id}>
              <ItemContent>
                <ItemTitle>
                  <Link to={`/finances/transactions?transactionId=${encodeURIComponent(item.id)}`}>
                    {item.merchant}
                  </Link>
                </ItemTitle>
                <ItemDescription>
                  {item.date} · {item.amount} {item.currencyCode ?? "currency unavailable"} ·{" "}
                  {item.direction} · {item.pending ? "Pending" : "Posted"}
                </ItemDescription>
              </ItemContent>
            </Item>
          ))}
        </ItemGroup>
        {items?.length === 0 ? <p className="text-sm">No other activity in this window.</p> : null}
        {nearby.data?.nextCursor ? (
          <p className="text-sm">
            Showing the latest 50 records in this window.{" "}
            <Link to={`/finances/transactions?accountId=${encodeURIComponent(context.accountId)}`}>
              Open account transactions
            </Link>{" "}
            to inspect more.
          </p>
        ) : null}
      </CollapsibleContent>
    </Collapsible>
  );
}
