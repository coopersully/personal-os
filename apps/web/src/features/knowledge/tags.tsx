import { ApiClientError } from "@personal-os/api-client";
import {
  type KnowledgeTagIndex,
  knowledgeTagsMax,
  normalizeKnowledgeTag,
} from "@personal-os/domain";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useId, useState } from "react";
import { api } from "@/api";
import { QueryFeedback } from "@/components/async-state";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Spinner } from "@/components/ui/spinner";
import { Toggle } from "@/components/ui/toggle";
import { type MemoryActions, memoryErrorStatus } from "./actions";
import { MemoryDialog } from "./record-detail";

/** The owner's tag index, shared by the filter chips and Manage tags. */
export function useMemoryTags(queryKey: readonly unknown[], actions: MemoryActions) {
  return useQuery({
    queryKey: [...queryKey, "tags"],
    queryFn: ({ signal }) => {
      signal.throwIfAborted();
      return actions.read(() => api.listKnowledgeTags());
    },
    placeholderData: keepPreviousData,
    retry: false,
  });
}

export function TagChips({
  index,
  selected,
  change,
}: {
  index: KnowledgeTagIndex | undefined;
  selected: string[];
  change: (tags: string[]) => void;
}) {
  const known = index?.tags.map((tag) => tag.name) ?? [];
  // A selected tag stays visible after a merge or refresh drops it from the index.
  const names = [...known, ...selected.filter((tag) => !known.includes(tag))];
  if (!names.length) return null;
  const counts = new Map(index?.tags.map((tag) => [tag.name, tag.count]));
  return (
    // biome-ignore lint/a11y/useSemanticElements: a group of toggle buttons, not a form fieldset.
    <div role="group" aria-label="Filter by tag" className="flex min-w-0 flex-wrap gap-1.5">
      {names.map((name) => {
        const pressed = selected.includes(name);
        return (
          <Toggle
            key={name}
            size="sm"
            variant="outline"
            aria-label={name}
            pressed={pressed}
            disabled={!pressed && selected.length >= knowledgeTagsMax}
            onPressedChange={(next) =>
              change(next ? [...selected, name] : selected.filter((tag) => tag !== name))
            }
          >
            {name}
            {counts.has(name) ? (
              <span aria-hidden="true" className="text-muted-foreground">
                {counts.get(name)}
              </span>
            ) : null}
          </Toggle>
        );
      })}
    </div>
  );
}

function errorMessage(error: unknown) {
  const status = memoryErrorStatus(error);
  return status && [404, 409, 422].includes(status) && error instanceof Error
    ? error.message
    : undefined;
}

/** Rename a tag by merging it into a new name, file it under another, or undo a merge. */
export function ManageTags({
  tags,
  actions,
  close,
  restoreFocus,
  onChanged,
}: {
  tags: ReturnType<typeof useMemoryTags>;
  actions: MemoryActions;
  close: () => void;
  restoreFocus: () => void;
  onChanged: () => void;
}) {
  const id = useId();
  const [from, setFrom] = useState("");
  const [into, setInto] = useState("");
  const index = tags.data;
  const source = from || index?.tags[0]?.name || "";

  function merge() {
    const target = normalizeKnowledgeTag(into);
    if (!source || target === null) {
      actions.notifyError("Enter a tag name with letters or numbers.");
      return;
    }
    void actions.run({
      pending: "Merging tags…",
      failure: "Couldn’t merge these tags. Try again.",
      request: () =>
        api.mergeKnowledgeTags({ from: source, into: target, mutationKey: crypto.randomUUID() }),
      complete: () => {
        setFrom("");
        setInto("");
        onChanged();
        return { message: "Tag merged." };
      },
      recover: errorMessage,
    });
  }

  function undo(mergeId: string) {
    void actions.run({
      pending: "Undoing merge…",
      failure: "Couldn’t undo this merge. Try again.",
      request: () => api.unmergeKnowledgeTags({ mergeId, mutationKey: crypto.randomUUID() }),
      complete: () => {
        onChanged();
        return { message: "Merge undone." };
      },
      recover: (error) => {
        const details = error instanceof ApiClientError ? error.details : undefined;
        const blocking =
          details && typeof details === "object" && "blockingMergeIds" in details
            ? (details as { blockingMergeIds: unknown }).blockingMergeIds
            : undefined;
        const later = Array.isArray(blocking)
          ? (index?.aliases ?? []).filter((alias) => blocking.includes(alias.mergeId))
          : [];
        if (later.length)
          return `Undo the later merge first: ${later
            .map((alias) => `${alias.alias} → ${alias.name}`)
            .join(", ")}.`;
        return errorMessage(error);
      },
    });
  }

  return (
    <MemoryDialog
      title="Manage tags"
      description="Rename a tag by merging it into a new name, or file it under an existing tag. You can undo a merge."
      busy={actions.busy}
      close={close}
      restoreFocus={restoreFocus}
      showFooter
    >
      <div className="flex min-w-0 flex-col gap-5">
        <QueryFeedback query={tags} title="Couldn’t load tags." />
        {tags.isPending ? <Spinner aria-label="Loading tags" /> : null}
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            merge();
          }}
        >
          <Field>
            <FieldLabel htmlFor={`${id}-from`}>Tag</FieldLabel>
            <NativeSelect
              id={`${id}-from`}
              value={source}
              disabled={actions.busy}
              onChange={(event) => setFrom(event.target.value)}
              className="w-full"
            >
              {index?.tags.map((tag) => (
                <NativeSelectOption key={tag.name} value={tag.name}>
                  {`${tag.name} (${tag.count})`}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
          <Field>
            <FieldLabel htmlFor={`${id}-into`}>Rename or merge into</FieldLabel>
            <Input
              id={`${id}-into`}
              value={into}
              autoComplete="off"
              disabled={actions.busy}
              onChange={(event) => setInto(event.target.value)}
            />
          </Field>
          <Button type="submit" className="w-fit" disabled={actions.busy || !source}>
            Merge tag
          </Button>
        </form>
        <section aria-label="Merged tags" className="flex flex-col gap-2">
          <h3 className="font-medium">Merged tags</h3>
          {index?.aliases.length ? (
            <ul className="flex flex-col gap-2">
              {index.aliases.map((alias) => (
                <li key={alias.mergeId} className="flex min-w-0 items-center justify-between gap-2">
                  <span className="min-w-0 [overflow-wrap:anywhere]">
                    {alias.alias} → {alias.name}
                  </span>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={actions.busy}
                    aria-label={`Undo merge of ${alias.alias}`}
                    onClick={() => undo(alias.mergeId)}
                  >
                    Undo
                  </Button>
                </li>
              ))}
            </ul>
          ) : index ? (
            <p className="text-muted-foreground">No merged tags yet.</p>
          ) : null}
        </section>
      </div>
    </MemoryDialog>
  );
}
