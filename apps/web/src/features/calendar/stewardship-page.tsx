import type {
  CalendarHealthAssessment,
  CalendarReview,
  CalendarSourceFreshness,
  CalendarStatus,
} from "@personal-os/domain";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  AlertTriangleIcon,
  ArrowLeftIcon,
  CircleCheckIcon,
  CircleHelpIcon,
  RefreshIcon,
  ShieldCheckIcon,
} from "@/components/icons";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import { Skeleton } from "@/components/ui/skeleton";
import { api, errorMessage } from "../../api.js";
import { calendarQueryKeys } from "./page.js";

const unsupportedDimensions =
  "Travel, protected time, load, recovery, and volatility are not calculated in this release.";

export function CalendarStewardshipPage() {
  const queryClient = useQueryClient();
  const status = useQuery({
    queryFn: api.getCalendarStatus,
    queryKey: calendarQueryKeys.status,
  });
  const assess = useMutation({
    mutationFn: () => api.createCalendarReview(),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: calendarQueryKeys.status });
    },
  });

  if (status.isPending) return <CalendarStewardshipSkeleton />;
  if (status.isError) {
    return (
      <CalendarStewardshipError
        error={status.error}
        onRetry={() => {
          void status.refetch();
        }}
      />
    );
  }

  const value = status.data;
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-6 md:px-6">
      <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div className="flex min-w-0 flex-col items-start gap-2">
          <Button asChild size="sm" variant="ghost">
            <Link to="/calendar">
              <ArrowLeftIcon aria-hidden="true" data-icon="inline-start" />
              Back to schedule
            </Link>
          </Button>
          <div>
            <p className="text-sm font-medium text-muted-foreground">Calendar Ilo</p>
            <h1 className="font-heading text-2xl font-medium tracking-tight">Schedule health</h1>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Evidence-bound review of source trust, conflicts, buffers, and tentative holds.
            </p>
          </div>
        </div>
        <Button disabled={assess.isPending} onClick={() => assess.mutate()}>
          <RefreshIcon aria-hidden="true" data-icon="inline-start" />
          {assess.isPending ? "Assessing…" : "Assess calendar"}
        </Button>
      </header>

      <div aria-live="polite" className="contents">
        {assess.isSuccess ? <p className="sr-only">Assessment complete.</p> : null}
        {assess.isError ? (
          <Alert variant="destructive">
            <AlertTriangleIcon aria-hidden="true" />
            <AlertTitle>Assessment unavailable</AlertTitle>
            <AlertDescription>{errorMessage(assess.error)}</AlertDescription>
          </Alert>
        ) : null}
      </div>

      <LifecyclePanel status={value} />
      <SourceEvidencePanel status={value} />
      <HealthDimensionsPanel health={value.health} />
      <FindingPanel review={value.latestReview} openFindingCount={value.backlog.openFindings} />
      <RecommendationPanel review={value.latestReview} />
    </main>
  );
}

function CalendarStewardshipSkeleton() {
  return (
    <main
      aria-busy="true"
      aria-label="Loading schedule health"
      className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-6 md:px-6"
    >
      <div className="flex flex-col gap-3">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-full max-w-xl" />
      </div>
      <Skeleton className="h-36 w-full" />
      <Skeleton className="h-48 w-full" />
      <Skeleton className="h-48 w-full" />
    </main>
  );
}

function CalendarStewardshipError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-6 md:px-6">
      <Alert variant="destructive">
        <AlertTriangleIcon aria-hidden="true" />
        <AlertTitle>Schedule health is unavailable</AlertTitle>
        <AlertDescription>{errorMessage(error)}</AlertDescription>
        <AlertAction>
          <Button onClick={onRetry} size="sm" variant="outline">
            Try again
          </Button>
        </AlertAction>
      </Alert>
    </main>
  );
}

function LifecyclePanel({ status }: { status: CalendarStatus }) {
  const copy = lifecycleCopy(status.lifecycle);
  const review = status.latestReview;
  return (
    <Card role="status">
      <CardHeader>
        <CardTitle>
          <h2>{copy.title}</h2>
        </CardTitle>
        <CardDescription>{copy.description}</CardDescription>
        <CardAction>
          <Badge variant={copy.badgeVariant}>{copy.label}</Badge>
        </CardAction>
      </CardHeader>
      <CardContent>
        {review ? (
          <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <Metadata label="Evidence through" value={formatDateTime(review.evidenceCutoff)} />
            <Metadata label="Next review" value={formatDateTime(review.nextMaintenanceAt)} />
            <Metadata label="Playbook" value={review.playbookVersion} />
            <Metadata label="Rulebook" value={review.rulebookVersion} />
          </dl>
        ) : (
          <p className="text-sm text-muted-foreground">
            The first assessment reviews 30 days behind and 90 days ahead using the evidence Ilo can
            currently read.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function SourceEvidencePanel({ status }: { status: CalendarStatus }) {
  const unsettled = status.sources.filter(
    (source) =>
      !source.readable || source.state !== "current" || source.completeness !== "complete",
  );
  if (unsettled.length > 0 || status.setupBlockers.length > 0) {
    const canOpenConnections = unsettled.some(({ recovery }) => recovery === "reconnect");
    return (
      <section aria-labelledby="source-evidence-attention">
        <Alert variant="warning">
          <AlertTriangleIcon aria-hidden="true" />
          <AlertTitle>
            <h2 id="source-evidence-attention">Source evidence needs attention</h2>
          </AlertTitle>
          <AlertDescription>
            <div className="flex flex-col gap-2">
              {unsettled.map((source) => (
                <div
                  className="flex flex-col gap-1"
                  key={`${source.accountId}:${source.calendarId}`}
                >
                  <p className="font-medium text-foreground">{sourceLabel(source)}</p>
                  <p>
                    {source.reason ?? `Evidence is ${source.state} and ${source.completeness}.`}
                  </p>
                  {sourceRecoveryCopy(source) ? <p>{sourceRecoveryCopy(source)}</p> : null}
                </div>
              ))}
              {status.setupBlockers.map((blocker) => (
                <p key={blocker}>{blocker}</p>
              ))}
            </div>
          </AlertDescription>
          {canOpenConnections ? (
            <AlertAction>
              <Button asChild size="sm" variant="outline">
                <Link to="/settings?section=connections">Open Connections</Link>
              </Button>
            </AlertAction>
          ) : null}
        </Alert>
      </section>
    );
  }

  return (
    <section aria-labelledby="source-evidence-heading" className="flex flex-col gap-3">
      <div>
        <h2 className="font-heading text-lg font-medium" id="source-evidence-heading">
          Source evidence
        </h2>
        <p className="text-sm text-muted-foreground">
          Freshness and completeness bound every conclusion below.
        </p>
      </div>
      {status.sources.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <CircleHelpIcon aria-hidden="true" />
            </EmptyMedia>
            <EmptyTitle>No source evidence is available</EmptyTitle>
            <EmptyDescription>An assessment cannot establish schedule health yet.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ItemGroup>
          {status.sources.map((source) => (
            <Item key={`${source.accountId}:${source.calendarId}`} variant="outline">
              <ItemMedia variant="icon">
                <CircleCheckIcon aria-hidden="true" />
              </ItemMedia>
              <ItemContent>
                <ItemTitle>{sourceLabel(source)}</ItemTitle>
                <ItemDescription>
                  Current and {source.completeness}. Evidence through{" "}
                  {formatDateTime(source.evidenceCutoff)}.
                </ItemDescription>
              </ItemContent>
              <ItemActions>
                {!source.writable ? <Badge variant="outline">Read only</Badge> : null}
                <Badge variant="secondary">Current</Badge>
              </ItemActions>
            </Item>
          ))}
        </ItemGroup>
      )}
    </section>
  );
}

function HealthDimensionsPanel({ health }: { health: CalendarHealthAssessment[] }) {
  const sourceBlocked = health.some(
    ({ dimension, signal }) => dimension === "source_trust" && signal === "unknown",
  );
  return (
    <section aria-labelledby="health-dimensions-heading" className="flex flex-col gap-3">
      <div>
        <h2 className="font-heading text-lg font-medium" id="health-dimensions-heading">
          Supported health checks
        </h2>
        <p className="text-sm text-muted-foreground">Trust signals, not a completeness score.</p>
      </div>
      {health.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <ShieldCheckIcon aria-hidden="true" />
            </EmptyMedia>
            <EmptyTitle>Health is not assessed yet</EmptyTitle>
            <EmptyDescription>Assess the calendar to establish supported signals.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ItemGroup>
          {health.map((assessment) => (
            <Item key={assessment.dimension} variant="outline">
              <ItemContent>
                <ItemTitle>{healthDimensionLabel(assessment.dimension)}</ItemTitle>
                <ItemDescription>
                  {assessment.signal === "unknown" && sourceBlocked
                    ? "Unknown until source evidence is current"
                    : assessment.summary}
                </ItemDescription>
              </ItemContent>
              <ItemActions>
                <Badge variant={signalBadgeVariant(assessment.signal)}>
                  {healthSignalLabel(assessment.signal)}
                </Badge>
              </ItemActions>
            </Item>
          ))}
        </ItemGroup>
      )}
    </section>
  );
}

function FindingPanel({
  review,
  openFindingCount,
}: {
  review: CalendarReview | null;
  openFindingCount: number | null;
}) {
  const findings = review?.findings.filter(({ status }) => status === "open") ?? [];
  return (
    <section aria-labelledby="findings-heading" className="flex flex-col gap-3">
      <div>
        <h2 className="font-heading text-lg font-medium" id="findings-heading">
          Findings
        </h2>
        <p className="text-sm text-muted-foreground">
          {openFindingCount === null
            ? "The open finding count is unknown."
            : `${openFindingCount} open ${openFindingCount === 1 ? "finding" : "findings"}.`}
        </p>
      </div>
      {openFindingCount === null ? (
        <>
          <Alert variant="info">
            <CircleHelpIcon aria-hidden="true" />
            <AlertTitle>Current finding count is unknown</AlertTitle>
            <AlertDescription>Assess again after source evidence is current.</AlertDescription>
          </Alert>
          {findings.length > 0 && review ? (
            <div className="flex flex-col gap-3">
              <div>
                <h3 className="font-heading text-base font-medium">Prior review findings</h3>
                <p className="text-sm text-muted-foreground">
                  Immutable evidence from the review created {formatDateTime(review.createdAt)}. It
                  does not establish the current finding count.
                </p>
              </div>
              <FindingItems findings={findings} />
            </div>
          ) : null}
        </>
      ) : openFindingCount === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <CircleCheckIcon aria-hidden="true" />
            </EmptyMedia>
            <EmptyTitle>No findings in the supported checks</EmptyTitle>
            <EmptyDescription>{unsupportedDimensions}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : findings.length > 0 ? (
        <FindingItems findings={findings} />
      ) : (
        <Alert variant="info">
          <CircleHelpIcon aria-hidden="true" />
          <AlertTitle>Finding details are unavailable</AlertTitle>
          <AlertDescription>
            The ledger reports open findings, but this review artifact does not contain them.
          </AlertDescription>
        </Alert>
      )}
      {openFindingCount !== null && openFindingCount > 0 ? (
        <p className="text-sm text-muted-foreground">{unsupportedDimensions}</p>
      ) : null}
    </section>
  );
}

function RecommendationPanel({ review }: { review: CalendarReview | null }) {
  const recommendations = review?.recommendations ?? [];
  return (
    <section aria-labelledby="recommendations-heading" className="flex flex-col gap-3">
      <div>
        <h2 className="font-heading text-lg font-medium" id="recommendations-heading">
          Recommendations
        </h2>
        <p className="text-sm text-muted-foreground">Recommendations are advisory.</p>
      </div>
      {recommendations.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <CircleHelpIcon aria-hidden="true" />
            </EmptyMedia>
            <EmptyTitle>
              {review ? "No advisory recommendations in this review" : "No review artifact yet"}
            </EmptyTitle>
            <EmptyDescription>
              {review
                ? "Ilo has no bounded recommendation for the supported evidence."
                : "Recommendations appear only after an evidence-bound assessment."}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ItemGroup>
          {recommendations.map((recommendation, index) => (
            <Item key={recommendationIdentity(review, recommendation, index)} variant="outline">
              <ItemContent>
                <ItemTitle>{recommendation.summary}</ItemTitle>
                <ItemDescription>
                  Confidence: {recommendation.confidence}. Assumptions:{" "}
                  {recommendation.assumptions.length > 0
                    ? recommendation.assumptions.join(" ")
                    : "None recorded."}{" "}
                  Tradeoffs:{" "}
                  {recommendation.tradeoffs.length > 0
                    ? recommendation.tradeoffs.join(" ")
                    : "None recorded."}
                </ItemDescription>
              </ItemContent>
            </Item>
          ))}
        </ItemGroup>
      )}
    </section>
  );
}

function FindingItems({ findings }: { findings: CalendarReview["findings"] }) {
  return (
    <ItemGroup>
      {findings.map((finding) => (
        <Item key={finding.id} variant="outline">
          <ItemContent>
            <ItemTitle>{finding.summary}</ItemTitle>
            <ItemDescription>
              {findingKindLabel(finding.kind)} · Last observed{" "}
              {formatDateTime(finding.lastObservedAt)}
            </ItemDescription>
          </ItemContent>
          <ItemActions>
            <Badge variant={finding.severity === "strained" ? "destructive" : "secondary"}>
              {titleCase(finding.severity)}
            </Badge>
          </ItemActions>
        </Item>
      ))}
    </ItemGroup>
  );
}

function Metadata({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="truncate">{value}</dd>
    </div>
  );
}

function lifecycleCopy(lifecycle: CalendarStatus["lifecycle"]): {
  badgeVariant: "destructive" | "outline" | "secondary";
  description: string;
  label: string;
  title: string;
} {
  switch (lifecycle) {
    case "never_maintained":
      return {
        badgeVariant: "outline",
        description: "No durable review exists, so schedule health is not established.",
        label: "Not assessed",
        title: "Calendar has not been assessed yet",
      };
    case "stale":
      return {
        badgeVariant: "outline",
        description: "The prior artifact remains visible, but its evidence is no longer current.",
        label: "Stale",
        title: "This review is stale",
      };
    case "queued":
      return {
        badgeVariant: "secondary",
        description: "The assessment has been accepted and has not started yet.",
        label: "Queued",
        title: "Assessment queued",
      };
    case "active":
      return {
        badgeVariant: "secondary",
        description: "Ilo is evaluating the available evidence.",
        label: "Assessing",
        title: "Assessment in progress",
      };
    case "maintained":
      return {
        badgeVariant: "secondary",
        description: "The supported checks have current, complete evidence.",
        label: "Reviewed",
        title: "Schedule reviewed",
      };
    case "maintained_with_questions":
      return {
        badgeVariant: "secondary",
        description: "The review is current and includes findings that deserve judgment.",
        label: "Reviewed with findings",
        title: "Schedule reviewed with findings",
      };
    case "blocked":
      return {
        badgeVariant: "outline",
        description: "Source or setup evidence prevents a current conclusion.",
        label: "Blocked",
        title: "Assessment is blocked",
      };
    case "failed":
      return {
        badgeVariant: "destructive",
        description: "The latest assessment did not produce a durable review.",
        label: "Failed",
        title: "Assessment failed",
      };
  }
}

function sourceLabel(source: CalendarSourceFreshness) {
  return `${titleCase(source.provider)} calendar`;
}

function sourceRecoveryCopy(source: CalendarSourceFreshness) {
  switch (source.recovery) {
    case "automatic":
      return "Ilo will retry this source.";
    case "operator":
      return "Ilo will keep retrying while its service operator resolves this constraint.";
    case "reconnect":
      return "Reconnect this calendar account.";
    default:
      return null;
  }
}

function healthDimensionLabel(dimension: CalendarHealthAssessment["dimension"]) {
  const labels: Record<CalendarHealthAssessment["dimension"], string> = {
    breaks_and_recovery: "Breaks and recovery",
    buffer_and_travel: "Buffers and travel",
    hard_conflicts: "Hard conflicts",
    meeting_load: "Meeting load",
    out_of_hours: "Out-of-hours commitments",
    protected_time: "Protected time",
    schedule_volatility: "Schedule volatility",
    source_trust: "Source trust",
  };
  return labels[dimension];
}

function healthSignalLabel(signal: CalendarHealthAssessment["signal"]) {
  return titleCase(signal);
}

function signalBadgeVariant(signal: CalendarHealthAssessment["signal"]) {
  if (signal === "strained") return "destructive" as const;
  return signal === "healthy" ? ("secondary" as const) : ("outline" as const);
}

function findingKindLabel(kind: CalendarReview["findings"][number]["kind"]) {
  const labels: Record<CalendarReview["findings"][number]["kind"], string> = {
    buffer_shortfall: "Buffer shortfall",
    event_overlap: "Event overlap",
    recurrence_unassessed: "Recurrence not assessed",
    source_stale: "Stale source",
    source_unavailable: "Unavailable source",
    tentative_hold: "Tentative hold",
  };
  return labels[kind];
}

function recommendationIdentity(
  review: CalendarReview,
  recommendation: CalendarReview["recommendations"][number],
  index: number,
) {
  const linkedFindings = [...recommendation.findingIds].sort().join(",") || "unlinked";
  return [
    review.id,
    recommendation.key,
    linkedFindings,
    recommendation.horizon.start,
    recommendation.horizon.end,
    index,
  ].join(":");
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function titleCase(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1).replaceAll("_", " ");
}
