import { ApiClientError } from "@personal-os/api-client";
import type { KnowledgeForgottenRecord, KnowledgeRecord } from "@personal-os/domain";
import { useQueries } from "@tanstack/react-query";
import { api } from "@/api";
import { ChevronRightIcon, RefreshIcon, TrashIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { type MemoryActions, memoryErrorStatus } from "./actions";
import {
  isTrashRoot,
  memoryAgo,
  memoryContent,
  memorySummary,
  memoryTrashDaysLeft,
} from "./presentation";

/** Spec §5.6: what Trash and delete now cannot reach. */
const backupLimit = "Older backups may still contain this until they're deleted.";
const agentLimit = "Agents that already read it may remember it.";

export const trashDescription =
  "This memory and anything derived from it move to Trash. You can restore them for 30 days, then they're deleted for good.";
export const deleteNowDescription =
  "This erases the memory and everything trashed with it. It can't be restored.";

/** How long a trashed memory has left, or which memory it restores with. */
export function TrashState({ record }: { record: KnowledgeRecord }) {
  if (!record.trashedAt) return null;
  if (!isTrashRoot(record))
    return (
      <span className="text-sm text-muted-foreground">
        Restores with the memory it was trashed with.
      </span>
    );
  const days = memoryTrashDaysLeft(record.trashedAt);
  return (
    <span className="text-sm text-muted-foreground">
      Trashed {memoryAgo(record.trashedAt)} · Deleted for good in {days}{" "}
      {days === 1 ? "day" : "days"}
    </span>
  );
}

/** The memories a record names: related records, relationship ends, meanings and sources. */
export function memoryLinks(record: KnowledgeRecord) {
  const { content } = record;
  const ids = [
    ...record.relatedRecordIds,
    ...(content.kind === "relationship" ? [content.value.subjectId, content.value.objectId] : []),
    ...(content.kind === "entity_meaning" ? [content.value.recordId] : []),
    ...record.sources.flatMap(({ availability, evidence }) =>
      !availability && evidence.type === "domain_record" && evidence.domain === "knowledge"
        ? [evidence.id]
        : [],
    ),
  ].map((id) => id.toLowerCase());
  return [...new Set(ids)].filter((id) => id !== record.id.toLowerCase());
}

function linkLabel(result: KnowledgeRecord | KnowledgeForgottenRecord | undefined) {
  if (!result) return null;
  if ("state" in result) return { title: "A deleted memory", text: "" };
  return memorySummary(memoryContent(result));
}

/**
 * Lists the memories this one links to: Trash leaves them in place, so the person can trash them
 * too. No API returns the memories that link here yet (COO-268), so the list says it is partial.
 */
export function TrashConfirmation({
  record,
  queryKey,
  actions,
  cancel,
  confirm,
}: {
  record: KnowledgeRecord;
  queryKey: readonly unknown[];
  actions: MemoryActions;
  cancel: () => void;
  confirm: () => void;
}) {
  const ids = memoryLinks(record);
  const links = useQueries({
    queries: ids.map((id) => ({
      queryKey: [...queryKey, "link", id],
      queryFn: ({ signal }: { signal: AbortSignal }) => {
        signal.throwIfAborted();
        return actions.read(() => api.getKnowledge({ id }));
      },
      retry: false,
    })),
  });
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-col gap-2 text-muted-foreground">
        <p>{backupLimit}</p>
        <p>{agentLimit}</p>
      </div>
      <section aria-label="Memories this one links to" className="flex flex-col gap-2">
        <h3 className="font-medium">Memories this one links to</h3>
        {ids.length ? (
          <>
            <p className="text-muted-foreground">
              These stay where they are. Trash them separately if they should go too.
            </p>
            <ul className="flex flex-col gap-1">
              {ids.map((id, index) => {
                const link = links[index];
                const label = linkLabel(link?.data);
                return (
                  <li key={id} className="flex min-w-0 flex-col">
                    {link?.isPending ? <Spinner aria-label="Loading a linked memory" /> : null}
                    {link?.isError ? (
                      <span className="text-muted-foreground">A memory you can't open</span>
                    ) : null}
                    {label ? (
                      <>
                        <span>{label.title}</span>
                        {label.text ? (
                          <span className="text-muted-foreground">{label.text}</span>
                        ) : null}
                      </>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </>
        ) : (
          <p className="text-muted-foreground">This memory doesn't link to other memories.</p>
        )}
        <p className="text-muted-foreground">
          Memories that link to this one aren't listed here yet. Check related memories before you
          trash it.
        </p>
      </section>
      <div className="grid gap-2 sm:grid-cols-2">
        <Button variant="secondary" disabled={actions.busy} onClick={cancel}>
          Cancel
        </Button>
        <Button variant="destructive" disabled={actions.busy} onClick={confirm}>
          <TrashIcon data-icon="inline-start" aria-hidden="true" />
          Move to Trash
        </Button>
      </div>
    </div>
  );
}

/** A restore the API refused because the memory came from memory still in Trash or deleted. */
class RestoreBlocked extends Error {}

function blockedBy(error: unknown) {
  const details = error instanceof ApiClientError ? error.details : undefined;
  const ids =
    details && typeof details === "object" && "blockedBy" in details
      ? (details as { blockedBy: unknown }).blockedBy
      : undefined;
  return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : [];
}

async function blockerNames(ids: string[]) {
  return Promise.all(
    ids.map(async (id) => {
      try {
        const label = linkLabel(await api.getKnowledge({ id }));
        return label?.title ?? "a memory you can't open";
      } catch {
        return "a memory you can't open";
      }
    }),
  );
}

/**
 * Restores a Trash group's root. A refusal is explained as it is, never as a change, and never
 * retried: the caller refreshes Trash and the person decides again.
 */
export function restoreMemory(
  actions: MemoryActions,
  record: KnowledgeRecord,
  handlers: { done: () => void; refused: () => void },
) {
  return actions.run({
    pending: "Restoring memory…",
    failure: "Couldn't confirm the restore. Check Trash before trying again.",
    request: async () => {
      try {
        return await api.updateKnowledge({
          action: "restore",
          recordId: record.id,
          expectedRevision: record.revision,
          mutationKey: crypto.randomUUID(),
        });
      } catch (error) {
        const ids = memoryErrorStatus(error) === 409 ? blockedBy(error) : [];
        if (!ids.length) throw error;
        const names = await blockerNames(ids);
        throw new RestoreBlocked(
          `This memory came from memory that is in Trash or deleted: ${names.join(", ")}. Restore that first, or leave this one in Trash.`,
        );
      }
    },
    complete: (result) => {
      handlers.done();
      return {
        message: result.outcome === "readable" ? "Memory restored." : "This memory is unavailable.",
      };
    },
    recover: (error) => {
      if (error instanceof RestoreBlocked) {
        handlers.refused();
        return error.message;
      }
      if (memoryErrorStatus(error) !== 409) return undefined;
      handlers.refused();
      const expired =
        (record.trashedAt !== null && memoryTrashDaysLeft(record.trashedAt) === 0) ||
        (error instanceof Error && /retention/i.test(error.message));
      return expired
        ? "This memory can no longer be restored. Its 30 days in Trash have ended."
        : "This memory couldn't be restored. Review Trash and try again.";
    },
  });
}

export function DeleteNowConfirmation({
  disabled,
  cancel,
  confirm,
}: {
  disabled: boolean;
  cancel: () => void;
  confirm: () => void;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-col gap-2 text-muted-foreground">
        <p>{backupLimit}</p>
        <p>{agentLimit}</p>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <Button variant="secondary" disabled={disabled} onClick={cancel}>
          Cancel
        </Button>
        <Button variant="destructive" disabled={disabled} onClick={confirm}>
          Delete now
        </Button>
      </div>
    </div>
  );
}

/** A Trash row: open the memory, and on a group's root restore it or delete it now. */
export function TrashRow({
  record,
  busy,
  open,
  restore,
  deleteNow,
}: {
  record: KnowledgeRecord;
  busy: boolean;
  open: (trigger: HTMLElement) => void;
  restore: () => void;
  deleteNow: (trigger: HTMLElement) => void;
}) {
  const { title, text } = memorySummary(memoryContent(record));
  return (
    <li className="flex min-w-0 flex-col gap-2 py-3">
      <Button
        variant="ghost"
        onClick={(event) => open(event.currentTarget)}
        className="h-auto w-full min-w-0 justify-between gap-3 rounded-lg px-2 py-1 text-left whitespace-normal"
      >
        <span className="flex min-w-0 flex-col gap-1 [overflow-wrap:anywhere]">
          <span>{title}</span>
          <span className="line-clamp-2 font-normal text-muted-foreground">{text}</span>
        </span>
        <ChevronRightIcon aria-hidden="true" />
      </Button>
      <div className="flex flex-wrap items-center gap-2 px-2">
        <TrashState record={record} />
        {isTrashRoot(record) ? (
          <span className="flex gap-2">
            <Button variant="secondary" size="sm" disabled={busy} onClick={restore}>
              <RefreshIcon data-icon="inline-start" aria-hidden="true" />
              Restore
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={busy}
              onClick={(event) => deleteNow(event.currentTarget)}
            >
              Delete now
            </Button>
          </span>
        ) : null}
      </div>
    </li>
  );
}
