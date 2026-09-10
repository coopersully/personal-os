import type { FinanceActionReview, FinanceQuestion } from "@personal-os/domain";
import { EmptyState, Spinner } from "@personal-os/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { CircleCheckIcon } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from "@/components/ui/item";
import { api } from "../../api.js";
import { InlineError } from "../../components/async-state.js";

function label(kind: string) {
  return kind === "maintenance_turn"
    ? "Maintained finances"
    : kind.replaceAll("_", " ").replace(/^./u, (value) => value.toUpperCase());
}

export function FinanceAgentReviewQueue() {
  const queryClient = useQueryClient();
  const questions = useQuery({
    queryFn: () => api.listFinanceQuestions(),
    queryKey: ["finance-questions"],
  });
  const reviews = useQuery({
    queryFn: () => api.listFinanceActionReviews(),
    queryKey: ["finance-action-reviews"],
  });
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["finance-questions"] }),
      queryClient.invalidateQueries({ queryKey: ["finance-action-reviews"] }),
      queryClient.invalidateQueries({ queryKey: ["finance-status"] }),
    ]);
  };
  const answer = useMutation({
    mutationFn: ({ id, value }: { id: string; value: string }) =>
      api.answerFinanceQuestion(id, value),
    onSuccess: refresh,
  });
  const approve = useMutation({ mutationFn: api.approveFinanceActionReview, onSuccess: refresh });
  const dismiss = useMutation({ mutationFn: api.dismissFinanceActionReview, onSuccess: refresh });
  const pendingQuestions = questions.data ?? [];
  const pendingReviews = (reviews.data ?? []).filter((item) => item.status === "pending");
  const error = questions.error ?? reviews.error ?? answer.error ?? approve.error ?? dismiss.error;

  return (
    <section aria-label="Agent review work" className="grid gap-4">
      <div>
        <h2 className="text-lg font-semibold">Review</h2>
        <p className="text-sm text-muted-foreground">
          Questions need your judgment. Approvals already contain a complete proposed change.
        </p>
      </div>
      {error ? <InlineError error={error} /> : null}
      {questions.isPending || reviews.isPending ? (
        <Spinner label="Loading Finance review work" />
      ) : null}
      {pendingQuestions.map((question) => (
        <QuestionCard
          answer={answers[question.id] ?? ""}
          isPending={answer.isPending}
          key={question.id}
          onAnswer={(value) => answer.mutate({ id: question.id, value })}
          onChange={(value) => setAnswers((current) => ({ ...current, [question.id]: value }))}
          question={question}
        />
      ))}
      {pendingReviews.map((review) => (
        <ReviewCard
          isPending={approve.isPending || dismiss.isPending}
          key={review.id}
          onApprove={() => approve.mutate(review.id)}
          onDismiss={() => dismiss.mutate(review.id)}
          review={review}
        />
      ))}
      {!questions.isPending &&
      !reviews.isPending &&
      pendingQuestions.length + pendingReviews.length === 0 ? (
        <EmptyState icon={<CircleCheckIcon />} title="Nothing needs review">
          Confident work is handled according to your Finance setting. Ambiguous activity will
          appear here.
        </EmptyState>
      ) : null}
    </section>
  );
}

function QuestionCard({
  answer,
  isPending,
  onAnswer,
  onChange,
  question,
}: {
  answer: string;
  isPending: boolean;
  onAnswer: (value: string) => void;
  onChange: (value: string) => void;
  question: FinanceQuestion;
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Badge>Question</Badge>
          <Badge variant="outline">{label(question.actionKind)}</Badge>
        </div>
        <CardTitle>{question.prompt}</CardTitle>
        <CardDescription>{question.why}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        {question.choices.length ? (
          <div className="flex flex-wrap gap-2">
            {question.choices.map((choice) => (
              <Button
                disabled={isPending}
                key={choice.value}
                onClick={() => onAnswer(choice.value)}
                size="sm"
                variant="outline"
              >
                {choice.label}
              </Button>
            ))}
          </div>
        ) : (
          <div className="flex gap-2">
            <Input
              aria-label="Your answer"
              onChange={(event) => onChange(event.target.value)}
              placeholder="Add the missing detail"
              value={answer}
            />
            <Button
              disabled={isPending || answer.trim().length === 0}
              onClick={() => onAnswer(answer.trim())}
            >
              Answer
            </Button>
          </div>
        )}
        {question.sourceRefs.length ? (
          <p className="text-xs text-muted-foreground">
            Based on {question.sourceRefs.length} ledger source{" "}
            {question.sourceRefs.length === 1 ? "record" : "records"}.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function ReviewCard({
  isPending,
  onApprove,
  onDismiss,
  review,
}: {
  isPending: boolean;
  onApprove: () => void;
  onDismiss: () => void;
  review: FinanceActionReview;
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Badge variant="secondary">Approval</Badge>
          <Badge variant="outline">{label(review.actionKind)}</Badge>
        </div>
        <CardTitle>
          {review.actionKind === "maintenance_turn"
            ? "Review one maintained ledger update"
            : `Review ${label(review.actionKind)}`}
        </CardTitle>
        <CardDescription>
          {review.changes.length} proposed {review.changes.length === 1 ? "change" : "changes"} ·
          prepared by {review.requestingAgentId}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <Collapsible>
          <CollapsibleTrigger asChild>
            <Button size="sm" variant="ghost">
              See evidence and changes
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <ItemGroup className="mt-2">
              {review.changes.map((change, index) => (
                <Item key={`${change.entityType}:${change.entityId ?? index}`} variant="outline">
                  <ItemContent>
                    <ItemTitle>{change.summary}</ItemTitle>
                    <ItemDescription>{change.entityType.replaceAll("_", " ")}</ItemDescription>
                  </ItemContent>
                </Item>
              ))}
            </ItemGroup>
            {review.assumptions.length ? (
              <p className="mt-2 text-xs text-muted-foreground">
                Assumptions: {review.assumptions.join(" · ")}
              </p>
            ) : null}
          </CollapsibleContent>
        </Collapsible>
        <ItemActions>
          <Button disabled={isPending} onClick={onApprove}>
            Approve
          </Button>
          <Button disabled={isPending} onClick={onDismiss} variant="outline">
            Dismiss
          </Button>
        </ItemActions>
      </CardContent>
    </Card>
  );
}
