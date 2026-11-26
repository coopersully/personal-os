import type { KnowledgeRecord } from "@personal-os/domain";
import { keepPreviousData, useQueries } from "@tanstack/react-query";
import { api } from "@/api";
import { QueryFeedback } from "@/components/async-state";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { type MemoryActions, readableMemory } from "./actions";
import {
  memoryAuthor,
  memoryContent,
  memoryOrigin,
  memorySummary,
  type OpenMemory,
} from "./presentation";

function ConflictValue({ label, record }: { label: string; record: KnowledgeRecord }) {
  const { text } = memorySummary(memoryContent(record));
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-lg border border-border/60 p-3">
      <span className="font-medium">{label}</span>
      <span className="whitespace-pre-wrap">{text}</span>
      <span className="text-sm text-muted-foreground">
        {memoryOrigin(record)} · saved by {memoryAuthor(record).toLowerCase()}
      </span>
    </div>
  );
}

/** Neither side of a resolution may be in Trash; the API refuses those (R28). */
function resolvable(proposal: KnowledgeRecord, mine: KnowledgeRecord) {
  return proposal.status === "proposed" && !proposal.trashedAt && !mine.trashedAt;
}

/**
 * A pending agent proposal is settled on the proposal itself: keep the person's memory, take the
 * agent's, or keep the person's and edit it starting from the agent's content. A trashed or
 * superseded record (`live` false), and two plain claims, are only compared and opened.
 */
export function ConflictPanel({
  record,
  live,
  queryKey,
  actions,
  openRecord,
  resolve,
  editMine,
}: {
  record: KnowledgeRecord;
  live: boolean;
  queryKey: readonly unknown[];
  actions: MemoryActions;
  openRecord: OpenMemory;
  resolve: (proposal: KnowledgeRecord, keep: "current" | "proposed") => void;
  editMine: (proposal: KnowledgeRecord, mine: KnowledgeRecord) => void;
}) {
  const others = useQueries({
    queries: record.conflictRecordIds.map((id) => ({
      queryKey: [...queryKey, "record", id],
      queryFn: ({ signal }: { signal: AbortSignal }) => {
        signal.throwIfAborted();
        return actions.read(() => api.getKnowledge({ id }).then(readableMemory));
      },
      placeholderData: keepPreviousData,
      retry: false,
    })),
  });
  return (
    <section aria-label="Conflict" className="flex flex-col gap-3">
      <h3 className="font-medium">Conflict</h3>
      {record.conflictRecordIds.map((id, index) => {
        const query = others[index];
        const other = query?.data;
        const proposal =
          record.status === "proposed" ? record : other?.status === "proposed" ? other : null;
        const mine = proposal === record ? other : record;
        return (
          <div key={id} className="flex flex-col gap-2">
            {query ? <QueryFeedback query={query} title="Couldn’t load the other memory." /> : null}
            {query?.isPending ? <Spinner aria-label="Loading the other memory" /> : null}
            {other && mine && proposal ? (
              <>
                <div className="grid gap-2 sm:grid-cols-2">
                  <ConflictValue label="Your version" record={mine} />
                  <ConflictValue label="Agent's proposal" record={proposal} />
                </div>
                {live && resolvable(proposal, mine) ? (
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      disabled={actions.busy}
                      onClick={() => resolve(proposal, "current")}
                    >
                      Keep mine
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={actions.busy}
                      onClick={() => resolve(proposal, "proposed")}
                    >
                      Take the agent's
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={actions.busy}
                      onClick={() => editMine(proposal, mine)}
                    >
                      Edit and keep mine
                    </Button>
                  </div>
                ) : null}
              </>
            ) : other ? (
              <div className="grid gap-2 sm:grid-cols-2">
                <ConflictValue label="This memory" record={record} />
                <ConflictValue label="Conflicting memory" record={other} />
              </div>
            ) : null}
            <Button variant="ghost" size="sm" className="w-fit" onClick={() => openRecord(id)}>
              Open conflicting memory {index + 1}
            </Button>
          </div>
        );
      })}
    </section>
  );
}
