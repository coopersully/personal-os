import type { FinanceCategory } from "@personal-os/domain";
import { Spinner } from "@personal-os/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button as ShadcnButton } from "@/components/ui/button";
import {
  Card as ShadcnCard,
  CardContent as ShadcnCardContent,
  CardDescription as ShadcnCardDescription,
  CardHeader as ShadcnCardHeader,
  CardTitle as ShadcnCardTitle,
} from "@/components/ui/card";
import { Checkbox as ShadcnCheckbox } from "@/components/ui/checkbox";
import { Input as ShadcnInput } from "@/components/ui/input";
import { api } from "../../api.js";
import { InlineError } from "../../components/async-state.js";

export function FinanceBudgetBucketManager({
  categories,
  month,
}: {
  categories: FinanceCategory[];
  month: string;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [selectedBucketId, setSelectedBucketId] = useState<string | null>(null);
  const buckets = useQuery({
    enabled: typeof api.listFinanceBudgetBuckets === "function",
    queryFn: () => api.listFinanceBudgetBuckets(month),
    queryKey: ["finance-budget-buckets", month],
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["finance-budget-buckets"] });
  const create = useMutation({
    mutationFn: () =>
      api.createFinanceBudgetBucket({
        description: description.trim() || null,
        idempotencyKey: crypto.randomUUID(),
        name: name.trim(),
      }),
    onSuccess: () => {
      setName("");
      setDescription("");
      return refresh();
    },
  });
  const taxonomy = buckets.data?.taxonomy;
  const selectedBucket = taxonomy?.buckets.find((bucket) => bucket.id === selectedBucketId);
  const update = useMutation({
    mutationFn: (input: { categoryIds: string[]; description: string | null }) => {
      if (!selectedBucket) throw new Error("Choose a bucket first.");
      return api.updateFinanceBudgetBucket(selectedBucket.id, {
        ...input,
        expectedVersion: selectedBucket.version,
        idempotencyKey: crypto.randomUUID(),
      });
    },
    onSuccess: refresh,
  });
  if (typeof api.listFinanceBudgetBuckets !== "function") return null;
  if (buckets.isPending) return <Spinner />;
  if (buckets.isError) return <InlineError error={buckets.error} />;
  return (
    <ShadcnCard className="mb-5">
      <ShadcnCardHeader>
        <ShadcnCardTitle>Budget buckets</ShadcnCardTitle>
        <ShadcnCardDescription>
          Group granular transaction categories for planning. Categories can belong to only one
          bucket.
        </ShadcnCardDescription>
      </ShadcnCardHeader>
      <ShadcnCardContent className="grid gap-4">
        <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
          <ShadcnInput
            aria-label="New bucket name"
            onChange={(event) => setName(event.target.value)}
            placeholder="New bucket"
            value={name}
          />
          <ShadcnInput
            aria-label="Bucket description"
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Optional description"
            value={description}
          />
          <ShadcnButton disabled={!name.trim() || create.isPending} onClick={() => create.mutate()}>
            Add bucket
          </ShadcnButton>
        </div>
        {taxonomy?.buckets.length ? (
          <div className="grid gap-4 md:grid-cols-[14rem_1fr]">
            <ul aria-label="Budget buckets" className="grid content-start gap-1">
              {taxonomy.buckets.map((bucket) => (
                <li key={bucket.id}>
                  <ShadcnButton
                    aria-pressed={selectedBucketId === bucket.id}
                    onClick={() => setSelectedBucketId(bucket.id)}
                    variant={selectedBucketId === bucket.id ? "secondary" : "ghost"}
                  >
                    {bucket.name}
                  </ShadcnButton>
                </li>
              ))}
            </ul>
            {selectedBucket ? (
              <div className="grid gap-3">
                <ShadcnInput
                  aria-label="Selected bucket description"
                  defaultValue={selectedBucket.description ?? ""}
                  disabled={update.isPending}
                  key={selectedBucket.id}
                  id="selected-bucket-description"
                  onBlur={(event) => {
                    const next = event.target.value.trim() || null;
                    if (next !== selectedBucket.description)
                      update.mutate({ categoryIds: selectedBucket.categories, description: next });
                  }}
                />
                <fieldset className="grid gap-2">
                  <legend className="text-sm font-medium">
                    Categories in {selectedBucket.name}
                  </legend>
                  {categories.map((category) => (
                    <label
                      className="flex items-center gap-2 text-sm"
                      htmlFor={`bucket-category-${category.id}`}
                      key={category.id}
                    >
                      <ShadcnCheckbox
                        checked={selectedBucket.categories.includes(category.id)}
                        disabled={update.isPending}
                        id={`bucket-category-${category.id}`}
                        onCheckedChange={(checked) => {
                          const current = new Set(selectedBucket.categories);
                          if (checked) current.add(category.id);
                          else current.delete(category.id);
                          update.mutate({
                            categoryIds: [...current],
                            description: selectedBucket.description,
                          });
                        }}
                      />
                      {category.name}
                    </label>
                  ))}
                </fieldset>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Select a bucket to manage its categories.
              </p>
            )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            No buckets yet. Existing category budgets remain under Unmapped categories.
          </p>
        )}
        {create.error || update.error ? <InlineError error={create.error ?? update.error} /> : null}
      </ShadcnCardContent>
    </ShadcnCard>
  );
}
