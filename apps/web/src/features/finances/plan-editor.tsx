import {
  type CreateFinanceBudgetVersionInput,
  createFinanceBudgetVersionInputSchema,
  type FinanceAccount,
  type FinanceBudgetAllocation,
  type FinanceBudgetResource,
  type FinanceBudgetVersion,
  type FinanceCategory,
  type FinanceGoal,
} from "@personal-os/domain";
import { useRef, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { errorMessage } from "../../api.js";
import { formatMoney } from "./format.js";
import { isConfirmedFinanceMutationFailure } from "./mutation-retry.js";
import {
  allocationLabels,
  isFinancePlanConflict,
  planAmountCents,
  resourceLabels,
} from "./plan-helpers.js";

type ResourceRow = { value: FinanceBudgetResource; amount: string; rowId: string };
type AllocationRow = { value: FinanceBudgetAllocation; amount: string; rowId: string };

function RecordChoice({
  id,
  label,
  value,
  options,
  onChange,
  required = false,
}: {
  id: string;
  label: string;
  value: string | undefined;
  options: { id: string; name: string }[];
  onChange: (id: string) => void;
  required?: boolean;
}) {
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <NativeSelect
        className="w-full"
        id={id}
        value={value ?? ""}
        required={required}
        onChange={(event) => onChange(event.target.value)}
      >
        <NativeSelectOption value="">
          {required ? "Choose a record" : "No linked record"}
        </NativeSelectOption>
        {value && !options.some((option) => option.id === value) ? (
          <NativeSelectOption value={value}>Saved record · {value}</NativeSelectOption>
        ) : null}
        {options.map((option) => (
          <NativeSelectOption key={option.id} value={option.id}>
            {option.name}
          </NativeSelectOption>
        ))}
      </NativeSelect>
    </Field>
  );
}

export function FinancePlanEditor({
  plan,
  categories,
  accounts,
  goals,
  onClose,
  onSave,
  pending,
  error,
  onReload,
}: {
  plan: FinanceBudgetVersion | null;
  categories: FinanceCategory[];
  accounts: FinanceAccount[];
  goals: FinanceGoal[];
  onClose: () => void;
  onSave: (input: CreateFinanceBudgetVersionInput) => void;
  pending: boolean;
  error: unknown;
  onReload: () => void;
}) {
  const [name, setName] = useState("Monthly plan");
  const [month, setMonth] = useState(plan?.effectiveFrom ?? new Date().toISOString().slice(0, 7));
  const [rationale, setRationale] = useState(plan?.rationale ?? "");
  const [assumptions, setAssumptions] = useState(() =>
    (plan?.assumptions ?? []).map((value) => ({ value, id: crypto.randomUUID() })),
  );
  const [resources, setResources] = useState<ResourceRow[]>(() =>
    (plan?.resources ?? [{ amount: 0, key: "Income", kind: "income" as const }]).map((value) => ({
      value,
      amount: plan ? value.amount.toFixed(2) : "",
      rowId: crypto.randomUUID(),
    })),
  );
  const [allocations, setAllocations] = useState<AllocationRow[]>(() =>
    (plan?.allocations ?? [{ amount: 0, key: "Spending", kind: "spending" as const }]).map(
      (value) => ({
        value,
        amount: plan ? value.amount.toFixed(2) : "",
        rowId: crypto.randomUUID(),
      }),
    ),
  );
  const attempt = useRef<{ payload: string; key: string } | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const resourceCents = resources.map((row) => planAmountCents(row.amount));
  const allocationCents = allocations.map((row) => planAmountCents(row.amount));
  const amountsValid = [...resourceCents, ...allocationCents].every((value) => value !== null);
  const resourceTotal = resourceCents.reduce<number>((sum, value) => sum + (value ?? 0), 0);
  const allocationTotal = allocationCents.reduce<number>((sum, value) => sum + (value ?? 0), 0);
  const delta = resourceTotal - allocationTotal;
  const balanced = amountsValid && delta === 0 && resources.length > 0 && allocations.length > 0;

  function updateResource(rowId: string, change: Partial<FinanceBudgetResource>) {
    setResources((rows) =>
      rows.map((row) =>
        row.rowId === rowId ? { ...row, value: { ...row.value, ...change } } : row,
      ),
    );
  }
  function updateAllocation(rowId: string, change: Partial<FinanceBudgetAllocation>) {
    setAllocations((rows) =>
      rows.map((row) =>
        row.rowId === rowId
          ? { ...row, value: { ...row.value, ...change } as FinanceBudgetAllocation }
          : row,
      ),
    );
  }
  function changeAllocationKind(rowId: string, kind: FinanceBudgetAllocation["kind"]) {
    setAllocations((rows) =>
      rows.map((row) => {
        if (row.rowId !== rowId) return row;
        const base = {
          amount: row.value.amount,
          key: row.value.key,
          ...(row.value.description ? { description: row.value.description } : {}),
        };
        const value: FinanceBudgetAllocation =
          kind === "debt"
            ? { ...base, kind, accountId: "" }
            : kind === "goal"
              ? { ...base, kind, goalId: "" }
              : { ...base, kind };
        return { ...row, value };
      }),
    );
  }
  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!balanced || pending) return;
    const input = {
      allocations: allocations.map((row) => ({ ...row.value, amount: Number(row.amount) })),
      assumptions: assumptions.map((row) => row.value),
      effectiveFrom: month,
      name,
      rationale,
      resources: resources.map((row) => ({ ...row.value, amount: Number(row.amount) })),
    };
    const parsed = createFinanceBudgetVersionInputSchema.safeParse({
      ...input,
      idempotencyKey: "validate",
    });
    if (!parsed.success) {
      setValidationError(
        parsed.error.issues.map((issue) => `${issue.path.join(" → ")}: ${issue.message}`).join(" "),
      );
      return;
    }
    if (
      new Set(input.resources.map((row) => row.key.trim())).size !== input.resources.length ||
      new Set(input.allocations.map((row) => row.key.trim())).size !== input.allocations.length
    ) {
      setValidationError("Give each resource a unique name and each allocation a unique name.");
      return;
    }
    const payload = JSON.stringify(parsed.data);
    if (attempt.current?.payload !== payload || isConfirmedFinanceMutationFailure(error))
      attempt.current = { payload, key: crypto.randomUUID() };
    setValidationError(null);
    onSave({ ...parsed.data, idempotencyKey: attempt.current.key });
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
    >
      <DialogContent
        className="max-h-[90dvh] overflow-y-auto sm:max-w-3xl"
        showCloseButton={!pending}
      >
        <DialogHeader>
          <DialogTitle>
            {plan ? `Revise version ${plan.version}` : "Create a complete plan"}
          </DialogTitle>
          <DialogDescription>
            Save a balanced proposal, then review and approve that exact version.
          </DialogDescription>
        </DialogHeader>
        <form className="grid gap-6" onSubmit={submit}>
          <FieldSet disabled={pending}>
            <FieldGroup className="sm:grid sm:grid-cols-2">
              {!plan ? (
                <Field>
                  <FieldLabel htmlFor="plan-name">Plan name</FieldLabel>
                  <Input
                    id="plan-name"
                    value={name}
                    required
                    maxLength={160}
                    onChange={(event) => setName(event.target.value)}
                  />
                </Field>
              ) : null}
              <Field>
                <FieldLabel htmlFor="plan-month">Effective month</FieldLabel>
                <Input
                  id="plan-month"
                  type="month"
                  required
                  value={month}
                  onChange={(event) => setMonth(event.target.value)}
                />
              </Field>
            </FieldGroup>
            <FieldSet>
              <FieldLegend>Resources</FieldLegend>
              {resources.map((row, index) => (
                <FieldGroup key={row.rowId} className="rounded-lg bg-muted/50 p-3">
                  <FieldGroup className="sm:grid sm:grid-cols-3">
                    <Field>
                      <FieldLabel htmlFor={`resource-name-${row.rowId}`}>
                        Resource {index + 1} name
                      </FieldLabel>
                      <Input
                        id={`resource-name-${row.rowId}`}
                        value={row.value.key}
                        required
                        maxLength={120}
                        onChange={(event) => updateResource(row.rowId, { key: event.target.value })}
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor={`resource-kind-${row.rowId}`}>
                        Resource {index + 1} kind
                      </FieldLabel>
                      <NativeSelect
                        className="w-full"
                        id={`resource-kind-${row.rowId}`}
                        value={row.value.kind}
                        onChange={(event) =>
                          updateResource(row.rowId, {
                            kind: event.target.value as FinanceBudgetResource["kind"],
                          })
                        }
                      >
                        {Object.entries(resourceLabels).map(([kind, label]) => (
                          <NativeSelectOption key={kind} value={kind}>
                            {label}
                          </NativeSelectOption>
                        ))}
                      </NativeSelect>
                    </Field>
                    <Field data-invalid={row.amount !== "" && planAmountCents(row.amount) === null}>
                      <FieldLabel htmlFor={`resource-amount-${row.rowId}`}>
                        Resource {index + 1} amount
                      </FieldLabel>
                      <Input
                        id={`resource-amount-${row.rowId}`}
                        inputMode="decimal"
                        required
                        aria-invalid={row.amount !== "" && planAmountCents(row.amount) === null}
                        value={row.amount}
                        onChange={(event) =>
                          setResources((rows) =>
                            rows.map((item) =>
                              item.rowId === row.rowId
                                ? { ...item, amount: event.target.value }
                                : item,
                            ),
                          )
                        }
                      />
                    </Field>
                  </FieldGroup>
                  <FieldGroup className="sm:grid sm:grid-cols-2">
                    <RecordChoice
                      id={`resource-source-${row.rowId}`}
                      label={`Resource ${index + 1} source`}
                      options={accounts}
                      value={row.value.sourceId}
                      onChange={(sourceId) =>
                        updateResource(row.rowId, { sourceId: sourceId || undefined })
                      }
                    />
                    <Field>
                      <FieldLabel htmlFor={`resource-description-${row.rowId}`}>
                        Resource {index + 1} description
                      </FieldLabel>
                      <Input
                        id={`resource-description-${row.rowId}`}
                        maxLength={500}
                        value={row.value.description ?? ""}
                        onChange={(event) =>
                          updateResource(row.rowId, {
                            description: event.target.value || undefined,
                          })
                        }
                      />
                    </Field>
                  </FieldGroup>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={resources.length === 1}
                    onClick={() =>
                      setResources((rows) => rows.filter((item) => item.rowId !== row.rowId))
                    }
                  >
                    Remove resource {index + 1}
                  </Button>
                </FieldGroup>
              ))}
              <Button
                type="button"
                variant="outline"
                disabled={resources.length >= 100}
                onClick={() =>
                  setResources((rows) => [
                    ...rows,
                    {
                      value: { amount: 0, key: "", kind: "income" },
                      amount: "",
                      rowId: crypto.randomUUID(),
                    },
                  ])
                }
              >
                Add resource
              </Button>
            </FieldSet>
            <FieldSet>
              <FieldLegend>Allocations</FieldLegend>
              {allocations.map((row, index) => (
                <FieldGroup key={row.rowId} className="rounded-lg bg-muted/50 p-3">
                  <FieldGroup className="sm:grid sm:grid-cols-3">
                    <Field>
                      <FieldLabel htmlFor={`allocation-name-${row.rowId}`}>
                        Allocation {index + 1} name
                      </FieldLabel>
                      <Input
                        id={`allocation-name-${row.rowId}`}
                        value={row.value.key}
                        required
                        maxLength={120}
                        onChange={(event) =>
                          updateAllocation(row.rowId, { key: event.target.value })
                        }
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor={`allocation-kind-${row.rowId}`}>
                        Allocation {index + 1} kind
                      </FieldLabel>
                      <NativeSelect
                        className="w-full"
                        id={`allocation-kind-${row.rowId}`}
                        value={row.value.kind}
                        onChange={(event) =>
                          changeAllocationKind(
                            row.rowId,
                            event.target.value as FinanceBudgetAllocation["kind"],
                          )
                        }
                      >
                        {Object.entries(allocationLabels).map(([kind, label]) => (
                          <NativeSelectOption key={kind} value={kind}>
                            {label}
                          </NativeSelectOption>
                        ))}
                      </NativeSelect>
                    </Field>
                    <Field data-invalid={row.amount !== "" && planAmountCents(row.amount) === null}>
                      <FieldLabel htmlFor={`allocation-amount-${row.rowId}`}>
                        Allocation {index + 1} amount
                      </FieldLabel>
                      <Input
                        id={`allocation-amount-${row.rowId}`}
                        inputMode="decimal"
                        required
                        aria-invalid={row.amount !== "" && planAmountCents(row.amount) === null}
                        value={row.amount}
                        onChange={(event) =>
                          setAllocations((rows) =>
                            rows.map((item) =>
                              item.rowId === row.rowId
                                ? { ...item, amount: event.target.value }
                                : item,
                            ),
                          )
                        }
                      />
                    </Field>
                  </FieldGroup>
                  <FieldGroup className="sm:grid sm:grid-cols-2">
                    {row.value.kind === "spending" ? (
                      <>
                        <RecordChoice
                          id={`allocation-category-${row.rowId}`}
                          label={`Allocation ${index + 1} category`}
                          options={categories}
                          value={row.value.categoryId}
                          onChange={(categoryId) =>
                            updateAllocation(row.rowId, { categoryId: categoryId || undefined })
                          }
                        />
                        <Field>
                          <FieldLabel htmlFor={`allocation-legacy-${row.rowId}`}>
                            Allocation {index + 1} category label
                          </FieldLabel>
                          <Input
                            id={`allocation-legacy-${row.rowId}`}
                            maxLength={240}
                            value={row.value.legacyCategory ?? ""}
                            onChange={(event) =>
                              updateAllocation(row.rowId, {
                                legacyCategory: event.target.value || undefined,
                              })
                            }
                          />
                        </Field>
                      </>
                    ) : null}
                    {row.value.kind === "debt" ? (
                      <RecordChoice
                        id={`allocation-account-${row.rowId}`}
                        label={`Allocation ${index + 1} account`}
                        required
                        options={accounts}
                        value={row.value.accountId}
                        onChange={(accountId) => updateAllocation(row.rowId, { accountId })}
                      />
                    ) : null}
                    {row.value.kind === "goal" || row.value.kind === "savings" ? (
                      <RecordChoice
                        id={`allocation-goal-${row.rowId}`}
                        label={`Allocation ${index + 1} goal`}
                        required={row.value.kind === "goal"}
                        options={goals}
                        value={row.value.goalId}
                        onChange={(goalId) =>
                          updateAllocation(row.rowId, { goalId: goalId || undefined })
                        }
                      />
                    ) : null}
                    <Field>
                      <FieldLabel htmlFor={`allocation-description-${row.rowId}`}>
                        Allocation {index + 1} description
                      </FieldLabel>
                      <Input
                        id={`allocation-description-${row.rowId}`}
                        maxLength={500}
                        value={row.value.description ?? ""}
                        onChange={(event) =>
                          updateAllocation(row.rowId, {
                            description: event.target.value || undefined,
                          })
                        }
                      />
                    </Field>
                  </FieldGroup>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={allocations.length === 1}
                    onClick={() =>
                      setAllocations((rows) => rows.filter((item) => item.rowId !== row.rowId))
                    }
                  >
                    Remove allocation {index + 1}
                  </Button>
                </FieldGroup>
              ))}
              <Button
                type="button"
                variant="outline"
                disabled={allocations.length >= 500}
                onClick={() =>
                  setAllocations((rows) => [
                    ...rows,
                    {
                      value: { amount: 0, key: "", kind: "spending" },
                      amount: "",
                      rowId: crypto.randomUUID(),
                    },
                  ])
                }
              >
                Add allocation
              </Button>
            </FieldSet>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="plan-rationale">Rationale</FieldLabel>
                <Textarea
                  id="plan-rationale"
                  required
                  maxLength={4000}
                  value={rationale}
                  onChange={(event) => setRationale(event.target.value)}
                />
              </Field>
              <FieldSet>
                <FieldLegend>Assumptions</FieldLegend>
                {assumptions.map((row, index) => (
                  <Field key={row.id}>
                    <FieldLabel htmlFor={`plan-assumption-${row.id}`}>
                      Assumption {index + 1}
                    </FieldLabel>
                    <Textarea
                      id={`plan-assumption-${row.id}`}
                      required
                      maxLength={1000}
                      value={row.value}
                      onChange={(event) =>
                        setAssumptions((rows) =>
                          rows.map((item) =>
                            item.id === row.id ? { ...item, value: event.target.value } : item,
                          ),
                        )
                      }
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        setAssumptions((rows) => rows.filter((item) => item.id !== row.id))
                      }
                    >
                      Remove assumption {index + 1}
                    </Button>
                  </Field>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  disabled={assumptions.length >= 100}
                  onClick={() =>
                    setAssumptions((rows) => [...rows, { id: crypto.randomUUID(), value: "" }])
                  }
                >
                  Add assumption
                </Button>
              </FieldSet>
            </FieldGroup>
          </FieldSet>
          <Alert variant={balanced ? "default" : "destructive"}>
            <AlertTitle>
              {!amountsValid
                ? "Enter amounts with up to two decimal places"
                : balanced
                  ? "Every cent assigned"
                  : `${formatMoney(Math.abs(delta) / 100)} ${delta > 0 ? "left to assign" : "over-assigned"}`}
            </AlertTitle>
            {amountsValid ? (
              <AlertDescription>
                Resources {formatMoney(resourceTotal / 100)} · Allocations{" "}
                {formatMoney(allocationTotal / 100)}
              </AlertDescription>
            ) : null}
          </Alert>
          {validationError ? (
            <Alert variant="destructive">
              <AlertTitle>Check the proposal</AlertTitle>
              <AlertDescription>{validationError}</AlertDescription>
            </Alert>
          ) : null}
          {error ? (
            <Alert variant="destructive">
              <AlertTitle>
                {isFinancePlanConflict(error)
                  ? "A newer version needs review"
                  : "Proposal could not be saved"}
              </AlertTitle>
              <AlertDescription>
                {errorMessage(error)} Your edits are still here.
                {isFinancePlanConflict(error) ? (
                  <Button type="button" variant="outline" onClick={onReload}>
                    Close editor and reload latest
                  </Button>
                ) : null}
              </AlertDescription>
            </Alert>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={pending} onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!balanced || pending || isFinancePlanConflict(error)}>
              {pending ? "Saving proposal…" : "Save proposal"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
