import type { FinanceAnswer, FinanceContextualQuestion } from "@personal-os/domain";
import { Spinner } from "@personal-os/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { api } from "../../api.js";
import { InlineError } from "../../components/async-state.js";

export function AddTransactionContext({ transactionId }: { transactionId: string }) {
  const navigate = useNavigate();
  const operationId = useRef<string | null>(null);
  const create = useMutation({
    mutationFn: () => {
      operationId.current ??= crypto.randomUUID();
      return api.createFinanceContextualQuestion(transactionId, {
        operationId: operationId.current,
      });
    },
    onSuccess: (result) => {
      if (result.state === "available")
        navigate(`/finances/review?contextualQuestion=${encodeURIComponent(result.question.id)}`);
    },
  });
  return (
    <div className="grid gap-2">
      <Button
        size="sm"
        variant="outline"
        disabled={create.isPending}
        onClick={() => create.mutate()}
      >
        {create.isPending ? "Opening context…" : "Add context"}
      </Button>
      {create.error ? <InlineError error={create.error} /> : null}
      {create.data?.state === "unavailable" ? (
        <p role="status" className="text-sm text-muted-foreground">
          Context is available for unresolved, uncategorized manual transactions.
        </p>
      ) : null}
    </div>
  );
}

export function FinanceContextualQuestionPage({ id }: { id: string }) {
  const query = useQuery({
    queryKey: ["finance-contextual-question", id],
    queryFn: () => api.getFinanceContextualQuestion(id),
  });
  return (
    <section aria-label="Transaction context" className="grid gap-4">
      {query.isPending ? <Spinner label="Loading transaction context" /> : null}
      {query.error ? (
        <>
          <InlineError error={query.error} />
          <Button variant="outline" onClick={() => void query.refetch()}>
            Reload context
          </Button>
        </>
      ) : null}
      {query.data?.state === "unavailable" ? (
        <p role="status">This context question is unavailable.</p>
      ) : null}
      {query.data?.state === "available" ? (
        <ContextAnswer
          key={`${id}:${query.data.question.work.revision}`}
          question={query.data.question}
        />
      ) : null}
    </section>
  );
}
function ContextAnswer({ question }: { question: FinanceContextualQuestion }) {
  const [text, setText] = useState("");
  const command = useRef<FinanceAnswer | null>(null);
  const client = useQueryClient();
  const answer = useMutation({
    mutationFn: () => {
      const normalized = text.trim();
      if (!command.current || command.current.text !== normalized)
        command.current = {
          operationId: crypto.randomUUID(),
          work: question.work,
          text: normalized,
          source: { kind: "app", messageId: null },
        };
      return api.answerFinanceContextualQuestion(command.current);
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["agent-access-work-items"] });
    },
  });
  const saved = question.status === "answered" || answer.data?.state === "accepted";
  const stale = question.status === "stale" || answer.data?.state === "blocked";
  const unavailable = answer.data?.state === "unavailable";
  return (
    <>
      <div>
        <h2 className="text-lg font-medium">{question.transaction.merchant}</h2>
        <p className="text-sm text-muted-foreground">
          {question.transaction.date} ·{" "}
          {question.transaction.currencyCode
            ? new Intl.NumberFormat(undefined, {
                style: "currency",
                currency: question.transaction.currencyCode,
              }).format(question.transaction.amountCents / 100)
            : `${question.transaction.amountCents / 100} (currency unavailable)`}
        </p>
      </div>
      {saved ? (
        <Alert>
          <AlertDescription>Context saved. The financial review remains open.</AlertDescription>
        </Alert>
      ) : stale ? (
        <Alert>
          <AlertDescription>
            This transaction changed. This question can no longer accept context.
          </AlertDescription>
        </Alert>
      ) : unavailable ? (
        <p role="status">This context question is unavailable.</p>
      ) : (
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (text.trim()) answer.mutate();
          }}
        >
          <Field>
            <FieldLabel htmlFor="transaction-context-answer">{question.prompt}</FieldLabel>
            <Textarea
              id="transaction-context-answer"
              value={text}
              onChange={(event) => setText(event.target.value)}
              required
              maxLength={10000}
              disabled={answer.isPending}
            />
          </Field>
          <p className="text-sm text-muted-foreground">
            Your answer adds context for review. It does not change the transaction or its category.
          </p>
          {answer.error ? <InlineError error={answer.error} /> : null}
          <Button
            className="justify-self-start"
            disabled={!text.trim() || answer.isPending}
            type="submit"
          >
            {answer.isPending ? "Saving context…" : "Save context"}
          </Button>
        </form>
      )}
      <div className="flex flex-wrap gap-4 text-sm">
        <Link
          className="underline underline-offset-4"
          to={`/finances/transactions?transactionId=${encodeURIComponent(question.transactionId)}`}
        >
          View transaction
        </Link>
        <Link
          className="underline underline-offset-4"
          to={`/finances/review/legacy?item=${encodeURIComponent(question.reviewCaseId)}`}
        >
          View financial review
        </Link>
      </div>
    </>
  );
}
