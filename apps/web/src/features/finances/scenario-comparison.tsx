import {
  type FinanceCategory,
  type FinanceScenarioInput,
  type FinanceScenarioResult,
  financeScenarioInputSchema,
} from "@personal-os/domain";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { api, errorMessage } from "../../api.js";
import { formatMoney } from "./format.js";

const moneyFields = [
  { key: "startingCash", label: "Starting cash", required: true },
  { key: "monthlyIncome", label: "Monthly income", required: true },
  { key: "monthlyHousingCost", label: "Monthly housing", required: true },
  { key: "monthlyDebtPayment", label: "Monthly debt payment", required: true },
  { key: "monthlyReserveContribution", label: "Monthly reserve contribution", required: true },
  { key: "debtBalance", label: "Debt balance", required: false },
  { key: "goalTarget", label: "Goal target", required: false },
  { key: "goalCurrent", label: "Current goal savings", required: false },
] as const;
type MoneyField = (typeof moneyFields)[number]["key"];
type ScenarioDraft = {
  id: string;
  label: string;
  money: Record<MoneyField, string>;
  assumptions: string;
  noOtherSpending: boolean;
  allocations: { id: string; categoryId: string; limit: string }[];
};
function newDraft(label: string): ScenarioDraft {
  return {
    id: crypto.randomUUID(),
    label,
    assumptions: "",
    noOtherSpending: false,
    allocations: [],
    money: {
      startingCash: "",
      monthlyIncome: "",
      monthlyHousingCost: "",
      monthlyDebtPayment: "",
      monthlyReserveContribution: "",
      debtBalance: "",
      goalTarget: "",
      goalCurrent: "",
    },
  };
}
function amount(value: string, signed = false): number | undefined {
  const pattern = signed ? /^-?\d+(?:\.\d{1,2})?$/ : /^\d+(?:\.\d{1,2})?$/;
  return pattern.test(value.trim()) ? Number(value) : undefined;
}
function scenarioInput(draft: ScenarioDraft): FinanceScenarioInput["baseline"] | null {
  if (!draft.noOtherSpending && draft.allocations.length === 0) return null;
  const values: Partial<Record<MoneyField, number>> = {};
  for (const field of moneyFields) {
    const value = amount(draft.money[field.key], field.key === "startingCash");
    if ((field.required || draft.money[field.key].trim()) && value === undefined) return null;
    if (value !== undefined) values[field.key] = value;
  }
  const allocations = draft.allocations.map((row) => ({
    categoryId: row.categoryId,
    limit: amount(row.limit),
  }));
  if (allocations.some((row) => row.limit === undefined)) return null;
  // The domain parser owns range, relation, and duplicate validation below.
  return {
    ...values,
    label: draft.label,
    budgetAllocations: allocations,
    assumptions: [
      ...draft.assumptions
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean),
      ...(draft.noOtherSpending
        ? [`${draft.label}: No category spending beyond housing and debt payments.`]
        : []),
    ],
  } as FinanceScenarioInput["baseline"];
}

function ScenarioFields({
  draft,
  index,
  categories,
  onChange,
  onRemove,
}: {
  draft: ScenarioDraft;
  index: number;
  categories: FinanceCategory[];
  onChange: (draft: ScenarioDraft) => void;
  onRemove: () => void;
}) {
  const prefix = index === 0 ? "Baseline" : `Alternative ${index}`;
  return (
    <FieldSet className="rounded-lg bg-muted/40 p-4">
      <FieldLegend>{prefix}</FieldLegend>
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor={`${draft.id}-label`}>{prefix} name</FieldLabel>
          <Input
            id={`${draft.id}-label`}
            value={draft.label}
            required
            maxLength={160}
            onChange={(event) => onChange({ ...draft, label: event.target.value })}
          />
        </Field>
        <FieldGroup className="sm:grid sm:grid-cols-2 lg:grid-cols-4">
          {moneyFields.map((field) => (
            <Field
              key={field.key}
              data-invalid={Boolean(
                draft.money[field.key] &&
                  amount(draft.money[field.key], field.key === "startingCash") === undefined,
              )}
            >
              <FieldLabel htmlFor={`${draft.id}-${field.key}`}>
                {prefix} {field.label.toLowerCase()}
                {field.required ? "" : " (optional)"}
              </FieldLabel>
              <Input
                id={`${draft.id}-${field.key}`}
                inputMode="decimal"
                required={field.required}
                aria-invalid={Boolean(
                  draft.money[field.key] &&
                    amount(draft.money[field.key], field.key === "startingCash") === undefined,
                )}
                value={draft.money[field.key]}
                onChange={(event) =>
                  onChange({ ...draft, money: { ...draft.money, [field.key]: event.target.value } })
                }
              />
            </Field>
          ))}
        </FieldGroup>
        <FieldSet>
          <FieldLegend>Other monthly spending</FieldLegend>
          <FieldDescription>
            Category amounts are in addition to housing, debt payments, and reserve contributions.
          </FieldDescription>
          {draft.allocations.map((row, rowIndex) => (
            <FieldGroup className="sm:grid sm:grid-cols-[1fr_1fr_auto]" key={row.id}>
              <Field>
                <FieldLabel htmlFor={`${row.id}-category`}>
                  {prefix} spending {rowIndex + 1} category
                </FieldLabel>
                <NativeSelect
                  className="w-full"
                  id={`${row.id}-category`}
                  required
                  value={row.categoryId}
                  onChange={(event) =>
                    onChange({
                      ...draft,
                      allocations: draft.allocations.map((item) =>
                        item.id === row.id ? { ...item, categoryId: event.target.value } : item,
                      ),
                    })
                  }
                >
                  <NativeSelectOption value="">Choose a category</NativeSelectOption>
                  {categories.map((category) => (
                    <NativeSelectOption key={category.id} value={category.id}>
                      {category.name}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </Field>
              <Field>
                <FieldLabel htmlFor={`${row.id}-limit`}>
                  {prefix} spending {rowIndex + 1} amount
                </FieldLabel>
                <Input
                  id={`${row.id}-limit`}
                  required
                  inputMode="decimal"
                  value={row.limit}
                  onChange={(event) =>
                    onChange({
                      ...draft,
                      allocations: draft.allocations.map((item) =>
                        item.id === row.id ? { ...item, limit: event.target.value } : item,
                      ),
                    })
                  }
                />
              </Field>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() =>
                  onChange({
                    ...draft,
                    allocations: draft.allocations.filter((item) => item.id !== row.id),
                  })
                }
              >
                Remove {prefix.toLowerCase()} spending {rowIndex + 1}
              </Button>
            </FieldGroup>
          ))}
          {draft.allocations.length === 0 ? (
            <Field orientation="horizontal">
              <Checkbox
                id={`${draft.id}-none`}
                checked={draft.noOtherSpending}
                onCheckedChange={(checked) =>
                  onChange({ ...draft, noOtherSpending: checked === true })
                }
              />
              <FieldLabel htmlFor={`${draft.id}-none`}>
                {prefix} has no other monthly spending
              </FieldLabel>
            </Field>
          ) : null}
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={categories.length === 0 || draft.allocations.length >= 100}
            onClick={() =>
              onChange({
                ...draft,
                noOtherSpending: false,
                allocations: [
                  ...draft.allocations,
                  { id: crypto.randomUUID(), categoryId: "", limit: "" },
                ],
              })
            }
          >
            Add {prefix.toLowerCase()} spending
          </Button>
        </FieldSet>
        <Field>
          <FieldLabel htmlFor={`${draft.id}-assumptions`}>{prefix} assumptions</FieldLabel>
          <Textarea
            id={`${draft.id}-assumptions`}
            value={draft.assumptions}
            onChange={(event) => onChange({ ...draft, assumptions: event.target.value })}
          />
          <FieldDescription>
            One assumption per line. Leave optional balances blank when unknown; enter 0 only when
            confirmed.
          </FieldDescription>
        </Field>
        {index > 0 ? (
          <Button type="button" variant="ghost" size="sm" onClick={onRemove}>
            Remove alternative {index}
          </Button>
        ) : null}
      </FieldGroup>
    </FieldSet>
  );
}

function ScenarioResult({
  result,
  horizonMonths,
  changed,
}: {
  result: FinanceScenarioResult;
  horizonMonths: number;
  changed: boolean;
}) {
  return (
    <section aria-label="Scenario comparison results" className="grid min-w-0 gap-5">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-base font-medium">Hypothetical comparison</h2>
        <Badge variant="secondary">Read only</Badge>
        {changed ? <Badge variant="outline">Previous inputs</Badge> : null}
      </div>
      <p className="text-sm text-muted-foreground">
        As of {result.asOf} · {horizonMonths} months. Your live plan is unchanged.
        {changed ? " Run the comparison again to include your edits." : ""}
      </p>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Scenario</TableHead>
            <TableHead className="text-right">Monthly cash flow</TableHead>
            <TableHead className="text-right">Lowest cash balance</TableHead>
            <TableHead className="text-right">Reserve runway</TableHead>
            <TableHead className="text-right">Debt payoff</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {[result.baseline, ...result.alternatives].map((projection) => (
            <TableRow key={projection.label}>
              <TableCell className="min-w-32 whitespace-normal">{projection.label}</TableCell>
              <TableCell className="text-right tabular-nums">
                {formatMoney(projection.monthlyCashFlow)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatMoney(projection.projectedLowestBalance)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {projection.reserveRunwayMonths === null
                  ? "Unavailable"
                  : `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(projection.reserveRunwayMonths)} months`}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {projection.debtPayoffMonths === null
                  ? "Unavailable"
                  : `${projection.debtPayoffMonths} months`}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {[
        { title: "Missing inputs", items: result.missingInputs },
        { title: "Sensitivity warnings", items: result.sensitivityWarnings },
        { title: "Goal conflicts", items: result.goalConflicts },
      ]
        .filter((group) => group.items.length > 0)
        .map((group) => (
          <Alert key={group.title}>
            <AlertTitle>{group.title}</AlertTitle>
            <AlertDescription>
              <ul className="grid list-disc gap-1 pl-4">
                {group.items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        ))}
      <section className="grid gap-2">
        <h3 className="font-medium">Assumptions used</h3>
        {result.assumptions.length ? (
          <ul className="grid list-disc gap-1 pl-5 text-sm">
            {result.assumptions.map((assumption) => (
              <li key={assumption}>{assumption}</li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">No additional assumptions recorded.</p>
        )}
      </section>
      {[result.baseline, ...result.alternatives]
        .filter((projection) => projection.goalDateEffects.length)
        .map((projection) => (
          <section className="grid gap-2" key={projection.label}>
            <h3 className="font-medium">{projection.label} · Goal effects</h3>
            <ul className="grid list-disc gap-1 pl-5 text-sm">
              {projection.goalDateEffects.map((effect) => (
                <li key={effect}>{effect}</li>
              ))}
            </ul>
          </section>
        ))}
    </section>
  );
}

export function FinanceScenarioComparison() {
  const [drafts, setDrafts] = useState(() => [
    newDraft("Current assumptions"),
    newDraft("Alternative"),
  ]);
  const [asOf, setAsOf] = useState(new Date().toISOString().slice(0, 10));
  const [horizon, setHorizon] = useState("12");
  const [submitted, setSubmitted] = useState("");
  const [validation, setValidation] = useState<string | null>(null);
  const categories = useQuery({
    queryKey: ["finance-categories"],
    queryFn: () => api.getFinanceCategories(),
  });
  const mutation = useMutation({
    mutationFn: (input: FinanceScenarioInput) => api.compareFinanceScenarios(input),
  });
  const signature = JSON.stringify({ drafts, asOf, horizon });
  const plans = drafts.map(scenarioInput);
  const ready = plans.every((plan) => plan !== null) && drafts.length >= 2;
  function compare(event: React.FormEvent) {
    event.preventDefault();
    if (!ready || mutation.isPending) return;
    const parsed = financeScenarioInputSchema.safeParse({
      asOf,
      horizonMonths: Number(horizon),
      baseline: plans[0],
      alternatives: plans.slice(1),
    });
    if (!parsed.success) {
      setValidation(
        parsed.error.issues.map((issue) => `${issue.path.join(" → ")}: ${issue.message}`).join(" "),
      );
      return;
    }
    if (new Set(drafts.map((draft) => draft.label.trim())).size !== drafts.length) {
      setValidation("Give each scenario a different name.");
      return;
    }
    setValidation(null);
    setSubmitted(signature);
    mutation.mutate(parsed.data);
  }
  return (
    <div className="grid min-w-0 gap-7">
      <p className="text-sm text-muted-foreground">
        Compare fixed monthly assumptions before changing your plan. Enter every required amount,
        including an explicit 0 when a cost does not apply.
      </p>
      <form className="grid gap-5" onSubmit={compare}>
        <FieldSet disabled={mutation.isPending}>
          <FieldGroup className="sm:grid sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="scenario-date">As of</FieldLabel>
              <Input
                id="scenario-date"
                type="date"
                required
                value={asOf}
                onChange={(event) => setAsOf(event.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="scenario-horizon">Horizon in months</FieldLabel>
              <Input
                id="scenario-horizon"
                type="number"
                min={1}
                max={120}
                required
                value={horizon}
                onChange={(event) => setHorizon(event.target.value)}
              />
            </Field>
          </FieldGroup>
          {categories.isError ? (
            <Alert variant="destructive">
              <AlertTitle>Spending categories unavailable</AlertTitle>
              <AlertDescription>
                {errorMessage(categories.error)}
                <Button type="button" variant="outline" onClick={() => void categories.refetch()}>
                  Retry categories
                </Button>
              </AlertDescription>
            </Alert>
          ) : null}
          {drafts.map((draft, index) => (
            <ScenarioFields
              key={draft.id}
              draft={draft}
              index={index}
              categories={categories.data ?? []}
              onChange={(next) =>
                setDrafts((current) => current.map((item) => (item.id === draft.id ? next : item)))
              }
              onRemove={() =>
                setDrafts((current) => current.filter((item) => item.id !== draft.id))
              }
            />
          ))}
          <Button
            type="button"
            variant="outline"
            disabled={drafts.length >= 6}
            onClick={() =>
              setDrafts((current) => [...current, newDraft(`Alternative ${current.length}`)])
            }
          >
            Add alternative
          </Button>
        </FieldSet>
        {validation ? (
          <Alert variant="destructive">
            <AlertTitle>Check scenario inputs</AlertTitle>
            <AlertDescription>{validation}</AlertDescription>
          </Alert>
        ) : null}
        {mutation.error ? (
          <Alert variant="destructive">
            <AlertTitle>Comparison failed</AlertTitle>
            <AlertDescription>
              {errorMessage(mutation.error)} Your assumptions are still here.
            </AlertDescription>
          </Alert>
        ) : null}
        <Button type="submit" disabled={!ready || mutation.isPending}>
          {mutation.isPending ? "Comparing…" : "Compare scenarios"}
        </Button>
      </form>
      {mutation.data && mutation.variables ? (
        <ScenarioResult
          result={mutation.data}
          horizonMonths={mutation.variables.horizonMonths}
          changed={submitted !== signature}
        />
      ) : null}
    </div>
  );
}
