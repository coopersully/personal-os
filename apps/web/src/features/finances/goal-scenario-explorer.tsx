import {
  type FinanceGoal,
  type GoalScenarioInput,
  projectGoalScenarios,
} from "@personal-os/domain";
import { useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import { goalProgressApplicability } from "./goal-progress-confirmation.js";

type Alternative = { id: string; name: string; amount: string };
type Projection = ReturnType<typeof projectGoalScenarios>;

function cents(value: string): number {
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!match) throw new Error("Enter each amount with at most two decimal places.");
  const result =
    (Number(match[2]) * 100 + Number((match[3] ?? "").padEnd(2, "0"))) * (match[1] ? -1 : 1);
  if (!Number.isSafeInteger(result)) throw new Error("Enter a smaller amount.");
  return result;
}

const reasons = {
  achieved: "Already achieved under these hypothetical inputs.",
  projected: "Hypothetical completion",
  progress_unknown: "Progress unknown. Enter an amount and confirm it for this exploration.",
  nonpositive_contribution: "No completion date: the monthly contribution is zero or negative.",
  beyond_horizon: "No completion within the 1200-month horizon or supported calendar.",
};

const targetReasons: Record<string, string> = {
  past_target_date: "Target date is in the past.",
  no_scheduled_contributions: "No scheduled contribution falls on or before this date.",
  progress_unknown: "Progress unknown.",
  achieved: "Already achieved.",
  beyond_horizon: "Target date is beyond the bounded horizon.",
  projected: "Unavailable.",
};

function formatCents(amountCents: number, currency: string): string {
  return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(
    amountCents / 100,
  );
}

function ContributionCurve({
  scenario,
  currency,
}: {
  scenario: Projection["scenarios"][number];
  currency: string;
}) {
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(0);
  const pageSize = 24;
  const pageCount = Math.ceil(scenario.curve.length / pageSize);
  const start = page * pageSize;
  return (
    <details onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary className="cursor-pointer">
        Hypothetical dated contribution curve for {scenario.name}
      </summary>
      {open ? (
        <div className="flex flex-col gap-2">
          <p>
            Contributions {start + 1}–{Math.min(start + pageSize, scenario.curve.length)} of{" "}
            {scenario.curve.length} · Page {page + 1} of {pageCount}
          </p>
          <Table aria-label={`Hypothetical contribution curve for ${scenario.name}`}>
            <TableHeader>
              <TableRow>
                <TableHead>Local date</TableHead>
                <TableHead>Cumulative contributions</TableHead>
                <TableHead>Hypothetical total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {scenario.curve.slice(start, start + pageSize).map((point) => (
                <TableRow key={point.localDate}>
                  <TableCell>{point.localDate}</TableCell>
                  <TableCell>{formatCents(point.cumulativeContributionCents, currency)}</TableCell>
                  <TableCell>{formatCents(point.projectedAmountCents, currency)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="secondary"
              aria-label={`Previous contributions for ${scenario.name}`}
              disabled={page === 0}
              onClick={() => setPage((value) => value - 1)}
            >
              Previous
            </Button>
            <Button
              type="button"
              variant="secondary"
              aria-label={`Next contributions for ${scenario.name}`}
              disabled={page + 1 === pageCount}
              onClick={() => setPage((value) => value + 1)}
            >
              Next
            </Button>
            <Button
              type="button"
              variant="ghost"
              aria-label={`Last contributions for ${scenario.name}`}
              disabled={page + 1 === pageCount}
              onClick={() => setPage(pageCount - 1)}
            >
              Last page
            </Button>
          </div>
        </div>
      ) : null}
    </details>
  );
}

/** View-only session state. Saved goal values never establish confirmed progress or currency. */
export function FinanceGoalScenarioExplorer({
  asOfLocalDate = "",
  connectedGoal,
  onConfirmProgress,
}: {
  asOfLocalDate?: string;
  connectedGoal?: { goal: FinanceGoal; ownerUserId: string; todayLocalDate: string };
  onConfirmProgress?: () => void;
}) {
  const applicability = connectedGoal
    ? goalProgressApplicability(
        connectedGoal.goal,
        connectedGoal.ownerUserId,
        connectedGoal.todayLocalDate,
      )
    : null;
  const evidence =
    applicability?.state === "applicable" && applicability.evidence.kind === "goal"
      ? applicability.evidence
      : null;
  const id = useId();
  const [draft, setDraft] = useState({
    target: connectedGoal ? String(connectedGoal.goal.targetAmount) : "",
    currency: evidence?.currencyCode ?? "",
    progress: evidence ? String(evidence.progressAmountCents / 100) : "",
    baseline: "",
    asOf: connectedGoal?.todayLocalDate ?? asOfLocalDate,
    firstDate: connectedGoal?.todayLocalDate ?? asOfLocalDate,
    targetDate: "",
  });
  const [confirmed, setConfirmed] = useState(false);
  const [alternatives, setAlternatives] = useState<Alternative[]>([]);
  const [projection, setProjection] = useState<Projection | null>(null);
  const results = useRef<HTMLElement>(null);
  useEffect(() => {
    if (projection) results.current?.focus();
  }, [projection]);
  const [validationError, setValidationError] = useState<string | null>(null);
  const clearDraftFeedback = () => {
    setProjection(null);
    setValidationError(null);
  };
  const update = (key: keyof typeof draft, value: string) => {
    setDraft((previous) => ({ ...previous, [key]: value }));
    if (key === "progress" || key === "currency" || key === "asOf") setConfirmed(false);
    clearDraftFeedback();
  };
  return (
    <section aria-labelledby={`${id}-title`} className="flex flex-col gap-4">
      <h2 id={`${id}-title`} className="font-semibold">
        {connectedGoal ? `Explore ${connectedGoal.goal.name}` : "Explore a hypothetical goal"}
      </h2>
      <p className="text-muted-foreground text-sm">
        See how a monthly contribution could change your goal date. No interest or growth is
        assumed. Exploring never changes saved goals, budgets, or allocations.
      </p>
      {connectedGoal ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm">
            {evidence
              ? `Saved progress confirmed by you as of ${evidence.asOf} · ${evidence.currencyCode}. This is your statement, not bank verification.`
              : "Current progress and currency are unknown for this goal version. Confirm them before using saved goal progress."}
          </p>
          {evidence ? (
            <details className="text-sm">
              <summary className="cursor-pointer">Saved progress evidence</summary>
              <p>
                Goal version {evidence.goalVersion} · Evidence {evidence.evidenceId} · As of{" "}
                {evidence.asOf}
              </p>
            </details>
          ) : null}
          {onConfirmProgress ? (
            <Button type="button" variant="secondary" onClick={onConfirmProgress}>
              {evidence ? "Reconfirm saved progress" : "Confirm saved progress"}
            </Button>
          ) : null}
        </div>
      ) : null}
      {projection &&
      (!connectedGoal ||
        (evidence &&
          projection.progress.sourceRevision === evidence.evidenceId &&
          projection.sourceGoalRevision ===
            `${connectedGoal.goal.id}:v${connectedGoal.goal.version}`)) ? (
        <section
          ref={results}
          tabIndex={-1}
          className="flex flex-col gap-4"
          aria-label="Hypothetical goal results"
        >
          <p className="text-sm text-muted-foreground">
            Hypothetical comparison · {projection.currency} · As of {projection.asOfLocalDate}.
            Nothing is saved.
          </p>
          <p>
            Hypothetical remaining target:{" "}
            {projection.remainingCents === null
              ? "Unknown"
              : formatCents(projection.remainingCents, projection.currency)}
          </p>
          {projection.scenarios.map((scenario) => (
            <section
              key={scenario.name}
              aria-label={`Hypothetical ${scenario.name}`}
              className="flex flex-col gap-2"
            >
              <h3 className="font-medium">
                {scenario.name} ·{" "}
                {formatCents(scenario.monthlyContributionCents, projection.currency)} each month
              </h3>
              <p>
                {reasons[scenario.reason]}
                {scenario.completionLocalDate ? `: ${scenario.completionLocalDate}` : ""}
              </p>
              {scenario.curve.length ? (
                <ContributionCurve scenario={scenario} currency={projection.currency} />
              ) : null}
            </section>
          ))}
          {projection.targetDateRequirement ? (
            <p>
              Hypothetical target date {projection.targetDateRequirement.localDate}:{" "}
              {projection.targetDateRequirement.requiredMonthlyContributionCents === null
                ? targetReasons[projection.targetDateRequirement.reason]
                : `${formatCents(projection.targetDateRequirement.requiredMonthlyContributionCents, projection.currency)} each month across ${projection.targetDateRequirement.scheduledContributionCount} scheduled contributions.`}
            </p>
          ) : null}
          <details>
            <summary className="cursor-pointer">Dates and assumptions</summary>
            <p className="text-sm">
              As of {projection.asOfLocalDate}; first contribution{" "}
              {projection.firstContributionLocalDate}. Monthly dates clamp to month-end and retain
              the original day anchor. No holiday adjustments. Maximum 1200 monthly contributions.
              Zero interest or growth.
            </p>
          </details>
        </section>
      ) : null}
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          try {
            const revision = `hypothetical-session:${crypto.randomUUID()}`;
            const input: GoalScenarioInput = {
              target: {
                amountCents: cents(
                  connectedGoal ? String(connectedGoal.goal.targetAmount) : draft.target,
                ),
                currency: evidence?.currencyCode ?? draft.currency.trim(),
              },
              sourceGoalRevision: connectedGoal
                ? `${connectedGoal.goal.id}:v${connectedGoal.goal.version}`
                : revision,
              asOfLocalDate: draft.asOf,
              progress: {
                amountCents: connectedGoal
                  ? (evidence?.progressAmountCents ?? null)
                  : draft.progress.trim()
                    ? cents(draft.progress)
                    : null,
                currency: evidence?.currencyCode ?? draft.currency.trim(),
                confirmed: connectedGoal ? evidence !== null : confirmed,
                provenance: connectedGoal
                  ? evidence
                    ? "explicit_user"
                    : null
                  : confirmed
                    ? "Explicit user confirmation for this hypothetical session"
                    : null,
                asOfLocalDate: connectedGoal ? (evidence?.asOf ?? null) : draft.asOf,
                sourceRevision: connectedGoal ? (evidence?.evidenceId ?? null) : revision,
              },
              baseline: { name: "Baseline", monthlyContributionCents: cents(draft.baseline) },
              alternatives: alternatives.map((row) => ({
                name: row.name,
                monthlyContributionCents: cents(row.amount),
              })),
              firstContributionLocalDate: draft.firstDate,
              ...(draft.targetDate ? { targetLocalDate: draft.targetDate } : {}),
            };
            setProjection(projectGoalScenarios(input));
            setValidationError(null);
          } catch (error) {
            const message =
              error instanceof Error ? error.message : "Check the hypothetical inputs.";
            setValidationError(message);
            toast.error(message);
          }
        }}
      >
        {validationError ? (
          <p role="alert" className="text-destructive text-sm">
            {validationError}
          </p>
        ) : null}
        <FieldSet>
          <FieldLegend>Hypothetical inputs</FieldLegend>
          <FieldGroup className="grid gap-4 sm:grid-cols-2">
            {(
              [
                ["target", "Hypothetical target amount", "text"],
                ["currency", "Currency code (two minor-unit digits)", "text"],
                ["progress", "Hypothetical current amount (blank means unknown)", "text"],
                ["baseline", "Baseline monthly contribution", "text"],
                ["asOf", "Projection as-of local date", "date"],
                ["firstDate", "First contribution local date", "date"],
                ["targetDate", "Optional target local date", "date"],
              ] as const
            ).map(([key, label, type]) => (
              <Field key={key}>
                <FieldLabel htmlFor={`${id}-${key}`}>
                  {connectedGoal && key === "target"
                    ? "Saved target amount"
                    : connectedGoal && key === "currency"
                      ? "Confirmed goal currency"
                      : connectedGoal && key === "progress"
                        ? "Confirmed goal progress"
                        : label}
                </FieldLabel>
                <Input
                  id={`${id}-${key}`}
                  type={type}
                  value={
                    connectedGoal && key === "target"
                      ? String(connectedGoal.goal.targetAmount)
                      : connectedGoal && key === "currency"
                        ? (evidence?.currencyCode ?? "")
                        : connectedGoal && key === "progress"
                          ? evidence
                            ? String(evidence.progressAmountCents / 100)
                            : ""
                          : draft[key]
                  }
                  disabled={Boolean(
                    connectedGoal && ["target", "currency", "progress"].includes(key),
                  )}
                  onChange={(event) => update(key, event.target.value)}
                  inputMode={type === "text" && key !== "currency" ? "decimal" : undefined}
                />
              </Field>
            ))}
          </FieldGroup>
          {!connectedGoal ? (
            <Field orientation="horizontal">
              <Checkbox
                id={`${id}-confirmed`}
                checked={confirmed}
                onCheckedChange={(value) => {
                  setConfirmed(value === true);
                  clearDraftFeedback();
                }}
              />
              <FieldLabel htmlFor={`${id}-confirmed`}>
                I confirm this current amount and currency for this hypothetical exploration.
              </FieldLabel>
            </Field>
          ) : null}
        </FieldSet>
        {alternatives.map((row, index) => (
          <FieldSet key={row.id}>
            <FieldLegend>Hypothetical alternative {index + 1}</FieldLegend>
            <FieldGroup className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor={`${id}-name-${index}`}>
                  Alternative {index + 1} name
                </FieldLabel>
                <Input
                  id={`${id}-name-${index}`}
                  value={row.name}
                  onChange={(event) => {
                    setAlternatives((rows) =>
                      rows.map((item, i) =>
                        i === index ? { ...item, name: event.target.value } : item,
                      ),
                    );
                    clearDraftFeedback();
                  }}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor={`${id}-amount-${index}`}>
                  Alternative {index + 1} monthly contribution
                </FieldLabel>
                <Input
                  id={`${id}-amount-${index}`}
                  inputMode="decimal"
                  value={row.amount}
                  onChange={(event) => {
                    setAlternatives((rows) =>
                      rows.map((item, i) =>
                        i === index ? { ...item, amount: event.target.value } : item,
                      ),
                    );
                    clearDraftFeedback();
                  }}
                />
              </Field>
            </FieldGroup>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setAlternatives((rows) => rows.filter((_, i) => i !== index));
                clearDraftFeedback();
              }}
            >
              Remove alternative {index + 1}
            </Button>
          </FieldSet>
        ))}
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="secondary"
            disabled={alternatives.length >= 3}
            onClick={() => {
              setAlternatives((rows) => [
                ...rows,
                { id: crypto.randomUUID(), name: `Alternative ${rows.length + 1}`, amount: "" },
              ]);
              clearDraftFeedback();
            }}
          >
            Add hypothetical alternative
          </Button>
          <Button type="submit" disabled={Boolean(connectedGoal && !evidence)}>
            Compare hypothetical contributions
          </Button>
        </div>
      </form>
    </section>
  );
}
