import type { MailReview, MailStatus, MailStewardshipQuestion } from "@personal-os/domain";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { AlertTriangleIcon, ArrowLeftIcon, CircleCheckIcon, RefreshIcon } from "@/components/icons";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { api, errorMessage } from "../../api.js";

export const mailStewardshipQueryKeys = {
  review: (id: string) => ["mail-stewardship-review", id] as const,
  status: ["mail-stewardship-status"] as const,
};

const stateCopy: Record<MailStatus["state"], { label: string; description: string }> = {
  blocked: {
    description: "Source evidence or an ambiguous provider effect prevents safe settlement.",
    label: "Blocked",
  },
  clean: {
    description:
      "Current evidence matches the durable ledger with no unresolved questions or effects.",
    label: "Clean",
  },
  needs_input: {
    description: "Ilo preserved material uncertainty as a bounded question instead of guessing.",
    label: "Needs your input",
  },
  needs_work: {
    description: "The ledger has outstanding work or needs a current review artifact.",
    label: "Needs work",
  },
};

export function MailStewardshipPage() {
  const queryClient = useQueryClient();
  const [params] = useSearchParams();
  const focusedQuestion = params.get("question");
  const status = useQuery({
    queryFn: api.getMailStatus,
    queryKey: mailStewardshipQueryKeys.status,
  });
  const maintain = useMutation({
    mutationFn: () => api.maintainMail({ scope: { type: "all_outstanding" } }),
    onSuccess: async (result) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: mailStewardshipQueryKeys.status }),
        queryClient.invalidateQueries({ queryKey: ["mail-maintenance-run", result.run.id] }),
      ]);
    },
  });
  const review = useQuery({
    enabled: Boolean(status.data?.details.latestReview?.id),
    queryFn: () => api.getMailReview(status.data?.details.latestReview?.id as string),
    queryKey: mailStewardshipQueryKeys.review(status.data?.details.latestReview?.id ?? "none"),
  });
  const answer = useMutation({
    mutationFn: ({ question, value }: { question: MailStewardshipQuestion; value: string }) =>
      api.answerMailQuestion(question.id, {
        answer: value,
        expectedVersion: question.version,
        generalize: false,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: mailStewardshipQueryKeys.status });
    },
  });

  if (status.isPending) return <MailStewardshipSkeleton />;
  if (status.isError) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-6 md:px-6">
        <Alert variant="destructive">
          <AlertTriangleIcon aria-hidden="true" />
          <AlertTitle>Mail stewardship is unavailable</AlertTitle>
          <AlertDescription>{errorMessage(status.error)}</AlertDescription>
        </Alert>
      </div>
    );
  }

  const value = status.data;
  const copy = stateCopy[value.state];
  const questions = value.details.openQuestions.toSorted((left, right) =>
    left.id === focusedQuestion ? -1 : right.id === focusedQuestion ? 1 : 0,
  );
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-6 md:px-6">
      <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div className="flex min-w-0 flex-col items-start gap-2">
          <Button asChild size="sm" variant="ghost">
            <Link to="/mail">
              <ArrowLeftIcon aria-hidden="true" data-icon="inline-start" />
              Back to inbox
            </Link>
          </Button>
          <div>
            <p className="text-sm font-medium text-muted-foreground">Mail Ilo</p>
            <h1 className="font-heading text-2xl font-medium tracking-tight">
              Workspace stewardship
            </h1>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Evidence-bound maintenance of obligations, decisions, rules, questions, and reviews.
              Ilo never sends email.
            </p>
          </div>
        </div>
        <Button disabled={maintain.isPending} onClick={() => maintain.mutate()}>
          <RefreshIcon aria-hidden="true" data-icon="inline-start" />
          {maintain.isPending ? "Maintaining…" : "Maintain Mail"}
        </Button>
      </header>

      {maintain.isError ? (
        <Alert variant="destructive">
          <AlertTriangleIcon aria-hidden="true" />
          <AlertTitle>Maintenance could not settle</AlertTitle>
          <AlertDescription>{errorMessage(maintain.error)}</AlertDescription>
        </Alert>
      ) : null}
      {maintain.data ? (
        <Alert>
          <CircleCheckIcon aria-hidden="true" />
          <AlertTitle>
            Maintenance turn settled as {maintenanceLabel(maintain.data.run.status)}
          </AlertTitle>
          <AlertDescription>{maintain.data.summary}</AlertDescription>
        </Alert>
      ) : null}

      <Card role="status">
        <CardHeader>
          <CardTitle>
            <h2>{copy.label}</h2>
          </CardTitle>
          <CardDescription>{copy.description}</CardDescription>
          <CardAction>
            <Badge variant={value.state === "blocked" ? "destructive" : "secondary"}>
              {copy.label}
            </Badge>
          </CardAction>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Metadata
            label="Evidence"
            value={`${label(value.freshness.state)} through ${formatDate(value.freshness.observedAt)}`}
          />
          <Metadata label="Objective" value={value.details.objective.summary} />
          <Metadata
            label="Profile"
            value={
              value.details.objective.profileVersion
                ? `Version ${value.details.objective.profileVersion}`
                : "Default objective"
            }
          />
          <Metadata
            label="Maintenance"
            value={value.activeRun ? maintenanceLabel(value.activeRun.status) : "No active turn"}
          />
        </CardContent>
      </Card>

      {value.freshness.blockers.length > 0 ? (
        <Alert variant="warning">
          <AlertTriangleIcon aria-hidden="true" />
          <AlertTitle>Evidence needs attention</AlertTitle>
          <AlertDescription>
            {value.freshness.blockers.map((blocker) => (
              <p key={blocker.code}>
                {blocker.message} {blocker.recovery}
              </p>
            ))}
          </AlertDescription>
        </Alert>
      ) : null}

      <section aria-labelledby="mail-ledger-heading" className="flex flex-col gap-3">
        <div>
          <h2 className="font-heading text-lg font-medium" id="mail-ledger-heading">
            Ledger
          </h2>
          <p className="text-sm text-muted-foreground">
            Current API-owned counts; the client does not infer completion.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Object.entries(value.details.obligationCounts).map(([state, count]) => (
            <Card key={state} size="sm">
              <CardHeader>
                <CardDescription>{label(state)}</CardDescription>
                <CardTitle>{count} obligations</CardTitle>
              </CardHeader>
            </Card>
          ))}
          <Card size="sm">
            <CardHeader>
              <CardDescription>Questions</CardDescription>
              <CardTitle>{value.details.openQuestionCount} open</CardTitle>
            </CardHeader>
          </Card>
          {Object.entries(value.details.effectCounts).map(([state, count]) => (
            <Card key={state} size="sm">
              <CardHeader>
                <CardDescription>{label(state)} effects</CardDescription>
                <CardTitle>{count}</CardTitle>
              </CardHeader>
            </Card>
          ))}
        </div>
      </section>

      <section aria-labelledby="mail-questions-heading" className="flex flex-col gap-3">
        <div>
          <h2 className="font-heading text-lg font-medium" id="mail-questions-heading">
            Questions
          </h2>
          <p className="text-sm text-muted-foreground">
            One-off answers stay local unless you explicitly propose reusable learning elsewhere.
          </p>
        </div>
        {questions.length === 0 ? (
          <p className="text-sm text-muted-foreground">No unanswered questions.</p>
        ) : (
          questions.map((question) => (
            <Card
              className={
                question.id === focusedQuestion ? "border-foreground bg-muted/30" : undefined
              }
              key={question.id}
            >
              <CardHeader>
                <CardTitle>{label(question.kind)}</CardTitle>
                <CardDescription>{question.reason}</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                {question.options.map((option) => (
                  <Button
                    disabled={answer.isPending}
                    key={option.value}
                    onClick={() => answer.mutate({ question, value: option.value })}
                    size="sm"
                    variant="outline"
                  >
                    {option.label}
                  </Button>
                ))}
              </CardContent>
            </Card>
          ))
        )}
      </section>

      <HealthPanel status={value} />
      <ReviewPanel review={review.data ?? null} pending={review.isPending} />
      <AuthorityPanel status={value} />
    </div>
  );
}

function HealthPanel({ status }: { status: MailStatus }) {
  return (
    <section aria-labelledby="mail-health-heading" className="flex flex-col gap-3">
      <div>
        <h2 className="font-heading text-lg font-medium" id="mail-health-heading">
          Health
        </h2>
        <p className="text-sm text-muted-foreground">
          Evidence-linked signals, not a universal score.
        </p>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {status.details.health.map((health) => (
          <Card key={health.dimension} size="sm">
            <CardHeader>
              <CardTitle>{label(health.dimension)}</CardTitle>
              <CardDescription>{health.summary}</CardDescription>
              <CardAction>
                <Badge
                  variant={
                    health.signal === "healthy"
                      ? "secondary"
                      : health.signal === "unknown"
                        ? "outline"
                        : "destructive"
                  }
                >
                  {label(health.signal)}
                </Badge>
              </CardAction>
            </CardHeader>
          </Card>
        ))}
      </div>
    </section>
  );
}

function ReviewPanel({ pending, review }: { pending: boolean; review: MailReview | null }) {
  return (
    <section aria-labelledby="mail-review-heading" className="flex flex-col gap-3">
      <div>
        <h2 className="font-heading text-lg font-medium" id="mail-review-heading">
          Immutable review artifact
        </h2>
        <p className="text-sm text-muted-foreground">
          Published evidence is never rewritten in place.
        </p>
      </div>
      {pending ? (
        <Skeleton className="h-40 w-full" />
      ) : review ? (
        <Card>
          <CardHeader>
            <CardTitle>{label(review.state)}</CardTitle>
            <CardDescription>
              Evidence through {formatDate(review.evidenceCutoff)} · next maintenance{" "}
              {formatDate(review.nextMaintenanceAt)}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Metadata label="Playbook" value={review.playbookVersion} />
            <Metadata label="Rulebook" value={review.rulebookVersion} />
            <Metadata label="Source freshness" value={label(review.sourceFreshness)} />
            <Metadata label="Open questions" value={String(review.openQuestionCount)} />
          </CardContent>
        </Card>
      ) : (
        <p className="text-sm text-muted-foreground">No review has been published yet.</p>
      )}
    </section>
  );
}

function AuthorityPanel({ status }: { status: MailStatus }) {
  const groups = [
    ["Automatic", status.details.authority.automatic],
    ["Approved rule", status.details.authority.approvedRule],
    ["Individual approval", status.details.authority.individualApproval],
    ["Not available", status.details.authority.unavailable],
  ] as const;
  return (
    <section aria-labelledby="mail-authority-heading" className="flex flex-col gap-3">
      <div>
        <h2 className="font-heading text-lg font-medium" id="mail-authority-heading">
          Authority boundaries
        </h2>
        <p className="text-sm text-muted-foreground">
          Transmission is permanently outside Ilo’s authority.
        </p>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {groups.map(([title, values]) => (
          <Card key={title} size="sm">
            <CardHeader>
              <CardTitle>{title}</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
                {values.map((value) => (
                  <li key={value}>{label(value)}</li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}

function MailStewardshipSkeleton() {
  return (
    <div
      aria-busy="true"
      aria-label="Loading Mail stewardship"
      className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-6 md:px-6"
      role="status"
    >
      <Skeleton className="h-16 w-full max-w-xl" />
      <Skeleton className="h-40 w-full" />
      <Skeleton className="h-56 w-full" />
    </div>
  );
}

function Metadata({ label: term, value }: { label: string; value: string }) {
  return (
    <dl>
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{term}</dt>
      <dd className="mt-1 text-sm">{value}</dd>
    </dl>
  );
}

function label(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}
function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(value),
  );
}
function maintenanceLabel(value: string) {
  return label(value);
}
