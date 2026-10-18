import { type GoalScenarioInput, projectGoalScenarios } from "@personal-os/domain";
import { useId, useState } from "react";
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

/** View-only session state. Saved goal values never establish confirmed progress or currency. */
export function FinanceGoalScenarioExplorer({ asOfLocalDate = "" }: { asOfLocalDate?: string }) {
  const id = useId();
  const [draft, setDraft] = useState({
    target: "",
    currency: "",
    progress: "",
    baseline: "",
    asOf: asOfLocalDate,
    firstDate: asOfLocalDate,
    targetDate: "",
  });
  const [confirmed, setConfirmed] = useState(false);
  const [alternatives, setAlternatives] = useState<Alternative[]>([]);
  const [projection, setProjection] = useState<Projection | null>(null);
  const update = (key: keyof typeof draft, value: string) => {
    setDraft((previous) => ({ ...previous, [key]: value }));
    if (key === "progress" || key === "currency" || key === "asOf") setConfirmed(false);
    setProjection(null);
  };
  const format = (amountCents: number) =>
    new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: projection?.currency ?? "USD",
    }).format(amountCents / 100);
  return (
    <section aria-labelledby={`${id}-title`} className="flex flex-col gap-4">
      <h2 id={`${id}-title`} className="font-semibold">
        Explore a hypothetical goal
      </h2>
      <p className="text-muted-foreground text-sm">
        Compare fixed monthly contributions with zero interest or growth. These inputs stay in this
        session and do not change goals, budgets, or allocations.
      </p>
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          try {
            const revision = `hypothetical-session:${crypto.randomUUID()}`;
            const input: GoalScenarioInput = {
              target: { amountCents: cents(draft.target), currency: draft.currency.trim() },
              sourceGoalRevision: revision,
              asOfLocalDate: draft.asOf,
              progress: {
                amountCents: draft.progress.trim() ? cents(draft.progress) : null,
                currency: draft.currency.trim(),
                confirmed,
                provenance: confirmed
                  ? "Explicit user confirmation for this hypothetical session"
                  : null,
                asOfLocalDate: draft.asOf,
                sourceRevision: revision,
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
          } catch (error) {
            toast.error(error instanceof Error ? error.message : "Check the hypothetical inputs.");
          }
        }}
      >
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
                <FieldLabel htmlFor={`${id}-${key}`}>{label}</FieldLabel>
                <Input
                  id={`${id}-${key}`}
                  type={type}
                  value={draft[key]}
                  onChange={(event) => update(key, event.target.value)}
                  inputMode={type === "text" && key !== "currency" ? "decimal" : undefined}
                />
              </Field>
            ))}
          </FieldGroup>
          <Field orientation="horizontal">
            <Checkbox
              id={`${id}-confirmed`}
              checked={confirmed}
              onCheckedChange={(value) => {
                setConfirmed(value === true);
                setProjection(null);
              }}
            />
            <FieldLabel htmlFor={`${id}-confirmed`}>
              I confirm this current amount and currency for this hypothetical exploration.
            </FieldLabel>
          </Field>
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
                    setProjection(null);
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
                    setProjection(null);
                  }}
                />
              </Field>
            </FieldGroup>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setAlternatives((rows) => rows.filter((_, i) => i !== index));
                setProjection(null);
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
              setProjection(null);
            }}
          >
            Add hypothetical alternative
          </Button>
          <Button type="submit">Compare hypothetical contributions</Button>
        </div>
      </form>
      {projection ? (
        <section className="flex flex-col gap-4" aria-label="Hypothetical goal results">
          <p className="text-sm">
            As of {projection.asOfLocalDate}; first contribution{" "}
            {projection.firstContributionLocalDate}. Monthly dates clamp to month-end and retain the
            original day anchor. No holiday adjustments. Maximum 1200 monthly contributions. Zero
            interest or growth.
          </p>
          <p>
            Hypothetical remaining target:{" "}
            {projection.remainingCents === null ? "Unknown" : format(projection.remainingCents)}
          </p>
          {projection.scenarios.map((scenario) => (
            <section
              key={scenario.name}
              aria-label={`Hypothetical ${scenario.name}`}
              className="flex flex-col gap-2"
            >
              <h3 className="font-medium">
                {scenario.name} · {format(scenario.monthlyContributionCents)} each month
              </h3>
              <p>
                {reasons[scenario.reason]}
                {scenario.completionLocalDate ? `: ${scenario.completionLocalDate}` : ""}
              </p>
              {scenario.curve.length ? (
                <details>
                  <summary className="cursor-pointer">
                    Hypothetical dated contribution curve for {scenario.name}
                  </summary>
                  <div className="max-h-72 overflow-auto">
                    <Table aria-label={`Hypothetical contribution curve for ${scenario.name}`}>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Local date</TableHead>
                          <TableHead>Cumulative contributions</TableHead>
                          <TableHead>Hypothetical total</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {scenario.curve.map((point) => (
                          <TableRow key={point.localDate}>
                            <TableCell>{point.localDate}</TableCell>
                            <TableCell>{format(point.cumulativeContributionCents)}</TableCell>
                            <TableCell>{format(point.projectedAmountCents)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </details>
              ) : null}
            </section>
          ))}
          {projection.targetDateRequirement ? (
            <p>
              Hypothetical target date {projection.targetDateRequirement.localDate}:{" "}
              {projection.targetDateRequirement.requiredMonthlyContributionCents === null
                ? targetReasons[projection.targetDateRequirement.reason]
                : `${format(projection.targetDateRequirement.requiredMonthlyContributionCents)} each month across ${projection.targetDateRequirement.scheduledContributionCount} scheduled contributions.`}
            </p>
          ) : null}
        </section>
      ) : null}
    </section>
  );
}
