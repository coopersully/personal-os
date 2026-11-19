import type {
  KnowledgeLifecycleInput,
  KnowledgeMutationInput,
  KnowledgeRecord,
  KnowledgeSource,
} from "@personal-os/domain";
import {
  keepPreviousData,
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { type ReactNode, useCallback, useLayoutEffect, useRef, useState } from "react";
import { api } from "@/api";
import { QueryFeedback } from "@/components/async-state";
import { ArchiveIcon, HistoryIcon, TrashIcon } from "@/components/icons";
import { RecoveryRequest } from "@/components/recovery-request";
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/responsive-dialog";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import {
  type MemoryActions,
  memoryErrorStatus,
  readableMemory,
  updateMemory,
  useMemoryWriteKey,
} from "./actions";
import { MemoryBadges, MemoryTags } from "./badges";
import { ConflictPanel } from "./conflict";
import {
  isTrashRoot,
  type MemoryOpenMode,
  memoryAuthor,
  memoryContent,
  memoryDate,
  memoryLabel,
  memorySummary,
  memoryUses,
  memoryWorkspace,
  type OpenMemory,
} from "./presentation";
import { MemoryWorkspace, memoryClaimFields, RecordEditor } from "./record-editor";
import { MemorySwitches } from "./switches";
import {
  DeleteNowConfirmation,
  deleteNowDescription,
  restoreMemory,
  TrashConfirmation,
  trashDescription,
} from "./trash";

type DetailMode = "detail" | "workspace" | "trash" | MemoryOpenMode;
/** `content` starts the editor from other content, such as an agent's proposal. */
type Selection = {
  id: string;
  mode?: MemoryOpenMode | undefined;
  content?: KnowledgeRecord["content"] | undefined;
};
type OpenRecord = OpenMemory;

export function MemoryDialog({
  title,
  description,
  children,
  footer,
  showFooter = footer !== undefined,
  busy,
  close,
  restoreFocus,
  safe = false,
}: {
  title: string;
  description: string;
  children: ReactNode;
  footer?: ReactNode;
  showFooter?: boolean;
  busy: boolean;
  close: () => void;
  restoreFocus: () => void;
  safe?: boolean;
}) {
  const heading = useRef<HTMLDivElement>(null);
  const safeButton = useRef<HTMLButtonElement>(null);

  const previousTitle = useRef(title);
  const focus = useCallback(() => {
    if (safe) safeButton.current?.focus();
    else heading.current?.focus();
  }, [safe]);

  useLayoutEffect(() => {
    if (previousTitle.current !== title) {
      previousTitle.current = title;
      focus();
    }
  }, [title, focus]);

  return (
    <ResponsiveDialog
      open
      dismissible={!busy}
      onOpenChange={(open) => {
        if (!open && !busy) close();
      }}
    >
      <ResponsiveDialogContent
        showCloseButton={false}
        className="min-w-0 sm:max-w-xl"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          focus();
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          restoreFocus();
        }}
      >
        <ResponsiveDialogHeader className="min-w-0 [overflow-wrap:anywhere]">
          <div ref={heading} tabIndex={-1}>
            <ResponsiveDialogTitle className="leading-snug">{title}</ResponsiveDialogTitle>
          </div>
          <ResponsiveDialogDescription>{description}</ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <ResponsiveDialogBody className="min-w-0 [overflow-wrap:anywhere]">
          {children}
        </ResponsiveDialogBody>
        {showFooter ? (
          <ResponsiveDialogFooter className="flex flex-wrap">
            {footer}
            <Button
              ref={safeButton}
              variant={safe ? "default" : "secondary"}
              disabled={busy}
              onClick={close}
              className="flex-1"
            >
              {safe ? "Cancel" : "Close"}
            </Button>
          </ResponsiveDialogFooter>
        ) : null}
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}

function MemoryFields({ fields }: { fields: Array<[string, string]> }) {
  return (
    <dl className="grid min-w-0 gap-3 sm:grid-cols-2">
      {fields.map(([label, value]) => (
        <div key={label} className="min-w-0">
          <dt className="font-medium">{label}</dt>
          <dd className="whitespace-pre-wrap text-muted-foreground">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function memoryUseFields(
  record: Pick<KnowledgeRecord, "scope" | "purposes" | "sensitivity">,
): Array<[string, string]> {
  return [
    ["Workspace", memoryWorkspace(record)],
    ["Uses", memoryUses(record)],
    ["Sensitivity", record.sensitivity === "sensitive" ? "Sensitive" : "Standard"],
  ];
}

function submittedFields(input: KnowledgeLifecycleInput): Array<[string, string]> {
  if (input.action === "revise") return memoryClaimFields(input.content);
  // Only the content and workspace editors offer a reviewed retry.
  const workspace = "workspace" in input ? input.workspace : null;
  return [["Workspace", workspace ? memoryLabel(workspace) : "All workspaces"]];
}

function SourceEvidence({
  source,
  openRecord,
}: {
  source: KnowledgeSource;
  openRecord?: OpenRecord;
}) {
  if (source.availability) return <span>Source unavailable</span>;
  const { evidence } = source;
  switch (evidence.type) {
    case "statement":
      return (
        <>
          <span>{evidence.wording}</span>
          {evidence.sessionRef ? (
            <span>
              Session <code>{evidence.sessionRef}</code>
            </span>
          ) : null}
          {evidence.messageRef ? (
            <span>
              Message <code>{evidence.messageRef}</code>
            </span>
          ) : null}
        </>
      );
    case "observation":
      return <span>{evidence.reference}</span>;
    case "domain_record":
      return evidence.domain === "knowledge" && openRecord ? (
        <Button
          variant="secondary"
          size="sm"
          className="h-auto w-fit max-w-full whitespace-normal"
          onClick={() => openRecord(evidence.id)}
        >
          Open source memory · revision {evidence.revision}
        </Button>
      ) : (
        <span>
          {memoryLabel(evidence.domain)} <code>{evidence.id}</code> · revision {evidence.revision}
        </span>
      );
    case "signed_inbound_message":
      return (
        <span>
          Message <code>{evidence.id}</code>
        </span>
      );
  }
}

function RecordSources({
  sources,
  openRecord,
}: {
  sources: KnowledgeRecord["sources"];
  openRecord?: OpenRecord;
}) {
  if (!sources.length) return <p className="text-muted-foreground">No source details available.</p>;
  return (
    <ul className="flex flex-col gap-2">
      {sources.map((source) => (
        <li key={source.id} className="flex min-w-0 flex-col gap-1 text-muted-foreground">
          <span>
            {memoryLabel(source.classification)} ·{" "}
            {source.actorType === "user" ? "You" : `Agent ${source.actorId}`}
          </span>
          <SourceEvidence source={source} {...(openRecord ? { openRecord } : {})} />
        </li>
      ))}
    </ul>
  );
}

function RecordInformation({
  record,
  openRecord,
}: {
  record: KnowledgeRecord;
  openRecord: OpenRecord;
}) {
  const content = memoryContent(record);
  const summary = memorySummary(content);
  const data: Array<[string, string]> = [
    ["Saved by", memoryAuthor(record)],
    ["Latest version", record.ownerHeld ? "Written or confirmed by you" : "Not confirmed by you"],
    ["Workspace", memoryWorkspace(record)],
    ["Uses", memoryUses(record)],
    // The API keeps createdAt across revisions; there is no updatedAt yet (COO-267).
    ["Added", memoryDate(record.createdAt)],
  ];
  if (record.lastConfirmedAt) data.push(["Last confirmed", memoryDate(record.lastConfirmedAt)]);
  if (record.validFrom) data.push(["Available from", memoryDate(record.validFrom)]);
  if (record.validUntil) data.push(["Available until", memoryDate(record.validUntil)]);
  if (record.reviewAt) data.push(["Review date", memoryDate(record.reviewAt)]);
  if (record.trashedAt) data.push(["Moved to Trash", memoryDate(record.trashedAt)]);
  if (content.kind === "inference")
    data.push(
      ["Uncertainty", content.value.uncertainty],
      ["Review condition", content.value.reviewCondition],
    );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <MemoryBadges record={record} />
        {summary.title.length > 80 ? <h3 className="font-medium">{summary.title}</h3> : null}
        <p className="whitespace-pre-wrap">{summary.text}</p>
        <MemoryTags tags={record.tags} />
      </div>
      <MemoryFields fields={data} />
      <section aria-label="Sources" className="flex flex-col gap-2">
        <h3 className="font-medium">Sources</h3>
        <RecordSources sources={record.sources} openRecord={openRecord} />
      </section>
      {record.supersededBy || record.relatedRecordIds.length ? (
        <section aria-label="Related memory" className="flex flex-col items-start gap-2">
          {record.supersededBy ? (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => openRecord(record.supersededBy as string)}
            >
              Open replacement
            </Button>
          ) : null}
          {record.relatedRecordIds.map((id, index) => (
            <Button key={id} variant="secondary" size="sm" onClick={() => openRecord(id)}>
              Open related memory {index + 1}
            </Button>
          ))}
        </section>
      ) : null}
      <details className="text-muted-foreground">
        <summary>Memory ID</summary>
        <code>{record.id}</code>
      </details>
    </div>
  );
}

function MemoryHistory({
  record,
  queryKey,
  actions,
}: {
  record: KnowledgeRecord;
  queryKey: readonly unknown[];
  actions: MemoryActions;
}) {
  const history = useInfiniteQuery({
    queryKey: [...queryKey, "history", record.id, record.revision],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) => {
      signal.throwIfAborted();
      return actions.read(
        () =>
          api.getKnowledgeHistory({
            recordId: record.id,
            ...(pageParam ? { cursor: pageParam } : {}),
          }),
        pageParam,
      );
    },
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    retry: false,
  });
  return (
    <section aria-label="Revision history" className="flex flex-col items-start gap-2">
      <QueryFeedback query={history} title="Couldn’t load memory history." />
      {history.isPending ? <Spinner aria-label="Loading revision history" /> : null}
      {history.data?.pages.some((page) => page.state !== "available") ? (
        <p className="text-muted-foreground">
          Some revisions are unavailable because their sources are unavailable.
        </p>
      ) : null}
      <ol className="flex w-full flex-col gap-2">
        {history.data?.pages
          .flatMap((page) => page.items)
          .map((revision) => (
            <li key={revision.revision} className="flex flex-col gap-1">
              <p className="font-medium">Revision {revision.revision}</p>
              <MemoryBadges record={revision} />
              <MemoryFields fields={memoryClaimFields(memoryContent(revision))} />
              {revision.sources.length ? (
                <details>
                  <summary>Sources for revision {revision.revision}</summary>
                  <RecordSources sources={revision.sources} />
                </details>
              ) : null}
              <p className="text-muted-foreground">
                {revision.author.actorType === "user"
                  ? "Saved by you"
                  : `Saved by agent ${revision.author.actorId}`}
              </p>
            </li>
          ))}
      </ol>
      {history.isError && !history.data ? (
        <Button variant="secondary" size="sm" onClick={() => void history.refetch()}>
          Retry history
        </Button>
      ) : null}
      {history.hasNextPage ? (
        <Button
          variant="secondary"
          size="sm"
          disabled={history.isFetchingNextPage}
          onClick={() => void history.fetchNextPage()}
        >
          Load more revisions
        </Button>
      ) : null}
    </section>
  );
}

export function NewMemory({
  actions,
  close,
  restoreFocus,
  onSaved,
}: {
  actions: MemoryActions;
  close: () => void;
  restoreFocus: () => void;
  onSaved: () => void;
}) {
  // An exact retry of an uncertain save reuses its key, so it cannot create a duplicate.
  const retryableInput = useMemoryWriteKey();
  const save = (input: KnowledgeMutationInput | KnowledgeLifecycleInput) => {
    if ("action" in input) return;
    void actions.run({
      pending: "Saving memory…",
      failure: "Couldn’t confirm the memory was saved. Check the list before trying again.",
      request: () => api.saveKnowledge(retryableInput(input)),
      complete: (result) => {
        close();
        onSaved();
        return result.outcome === "readable"
          ? { message: "Memory saved." }
          : { message: "This memory is unavailable.", tone: "info" };
      },
    });
  };
  return (
    <MemoryDialog
      title="Add memory"
      description="Choose the information you want nohmi to remember."
      busy={actions.busy}
      close={close}
      restoreFocus={restoreFocus}
    >
      <RecordEditor
        disabled={actions.busy}
        onSave={save}
        onInvalid={() => actions.notifyError("Check the highlighted memory fields.")}
        footer={
          <Button variant="secondary" disabled={actions.busy} onClick={close}>
            Cancel
          </Button>
        }
      />
    </MemoryDialog>
  );
}

export function MemoryRecordDetail({
  selection,
  queryKey,
  actions,
  close,
  restoreFocus,
  openRecord,
  onChanged,
}: {
  selection: Selection;
  queryKey: readonly unknown[];
  actions: MemoryActions;
  close: () => void;
  restoreFocus: () => void;
  openRecord: OpenRecord;
  onChanged: () => void;
}) {
  const { id } = selection;
  const cache = useQueryClient();
  const detailKey = [...queryKey, "record", id];
  const detail = useQuery<KnowledgeRecord>({
    queryKey: detailKey,
    queryFn: ({ signal }) => {
      signal.throwIfAborted();
      return actions.read(() => api.getKnowledge({ id }).then(readableMemory));
    },
    // A refresh after an action keeps the record on screen until the new read arrives.
    placeholderData: keepPreviousData,
    retry: false,
  });
  const [mode, setMode] = useState<DetailMode>(selection.mode ?? "detail");
  const [localRecord, setLocalRecord] = useState<KnowledgeRecord | null>(null);
  const [draftRecord, setDraftRecord] = useState<KnowledgeRecord | null>(null);
  const [history, setHistory] = useState(false);
  const [conflict, setConflict] = useState<KnowledgeLifecycleInput | null>(null);
  const [reviewed, setReviewed] = useState<KnowledgeRecord | null>(null);
  const accessLost = [401, 403, 404].includes(memoryErrorStatus(detail.error) ?? 0);
  const fetched = detail.isPlaceholderData ? undefined : detail.data;
  const record = accessLost ? undefined : (fetched ?? localRecord ?? detail.data);
  // Editors work on the revision the person started from, never a later refresh.
  if (mode === "edit" && !draftRecord && record) setDraftRecord(record);

  const summary = record && memorySummary(memoryContent(record));
  const trashed = Boolean(record?.trashedAt);
  const live = record && !trashed && record.status !== "superseded";
  const editable = live && ["active", "disputed", "expired"].includes(record.status);

  /** Simple actions refresh and show the latest memory on a conflict, never retrying. */
  function act(input: KnowledgeLifecycleInput, success?: string) {
    const leaves = ["archive", "unarchive", "trash", "restore", "delete_now", "resolve_conflict"];
    void updateMemory(actions, input, {
      ...(success ? { success } : {}),
      done: (result) => {
        onChanged();
        if (leaves.includes(input.action) || result.outcome !== "readable") close();
        else setLocalRecord(result.record);
      },
      conflict: () => {
        setMode("detail");
        onChanged();
        return undefined;
      },
    });
  }

  /** Editors keep the draft on a conflict and offer the latest revision for review. */
  function save(input: KnowledgeMutationInput | KnowledgeLifecycleInput) {
    if (!("action" in input)) return;
    void updateMemory(actions, input, {
      done: (result) => {
        setMode("detail");
        setDraftRecord(null);
        onChanged();
        if (result.outcome === "readable") setLocalRecord(result.record);
        else close();
      },
      conflict: () => {
        setConflict(input);
        setReviewed(null);
        return "The memory changed before this update. Review the latest revision.";
      },
    });
  }

  function reviewLatest() {
    void actions.run({
      pending: "Loading the latest memory…",
      failure: "Couldn’t load the latest memory.",
      request: () => api.getKnowledge({ id }).then(readableMemory),
      complete: (current) => {
        setReviewed(current);
        return undefined;
      },
      recover: (error) => {
        if (![401, 403, 404].includes(memoryErrorStatus(error) ?? 0)) return undefined;
        close();
        return "This memory is no longer available.";
      },
    });
  }

  function identity(target: KnowledgeRecord) {
    return {
      recordId: target.id,
      expectedRevision: target.revision,
      mutationKey: crypto.randomUUID(),
    };
  }

  /**
   * Keeps the person's memory, retiring the proposal, then edits it starting from the agent's
   * content. Nothing opens unless the proposal was resolved, so it never stays pending.
   */
  function editKeepingMine(proposal: KnowledgeRecord, mine: KnowledgeRecord) {
    void updateMemory(
      actions,
      { ...identity(proposal), action: "resolve_conflict", keep: "current" },
      {
        success: "Kept your version. Edit it with the agent's proposal.",
        done: () => {
          onChanged();
          openRecord(mine.id, "edit", memoryContent(proposal));
        },
        conflict: () => {
          onChanged();
          return undefined;
        },
      },
    );
  }

  function deleteNow() {
    if (!record) return;
    if (record.trashVersion === undefined) {
      actions.notifyError("Reload Trash before deleting this memory.");
      return;
    }
    act({ ...identity(record), action: "delete_now", expectedTrashVersion: record.trashVersion });
  }

  function startEditor(next: "edit" | "workspace") {
    if (!record) return;
    setDraftRecord(record);
    setMode(next);
  }
  function goBack() {
    setDraftRecord(null);
    setMode("detail");
  }
  const back = (
    <Button type="button" variant="secondary" disabled={actions.busy} onClick={goBack}>
      Back to memory
    </Button>
  );
  const invalid = () => actions.notifyError("Check the highlighted memory fields.");
  const titles: Record<Exclude<DetailMode, "detail">, [string, string]> = {
    edit: ["Edit memory", "Save your correction as a new revision."],
    workspace: ["Change workspace", "Choose where this memory can be used."],
    trash: ["Move to Trash?", trashDescription],
    delete: ["Delete now?", deleteNowDescription],
  };
  const [title, description] =
    mode === "detail"
      ? [
          summary && summary.title.length <= 80 ? summary.title : "Memory details",
          record
            ? `${memoryLabel(memoryContent(record).kind)} · revision ${record.revision}`
            : "View the saved record.",
        ]
      : titles[mode];
  const detailShown = mode === "detail" || accessLost;

  return (
    <>
      <MemoryDialog
        title={title}
        description={description}
        busy={actions.busy}
        close={detailShown ? close : goBack}
        restoreFocus={restoreFocus}
        showFooter={detailShown}
        footer={
          !accessLost && mode === "detail" && editable ? (
            <Button
              disabled={actions.busy}
              variant="secondary"
              onClick={() => startEditor("edit")}
              className="flex-1"
            >
              Edit memory
            </Button>
          ) : undefined
        }
      >
        {detailShown ? (
          <div className="flex flex-col gap-4">
            <QueryFeedback query={detail} title="Couldn’t open this memory." />
            {detail.isPending && !record ? <Spinner aria-label="Loading memory details" /> : null}
            {detail.isError && !record ? (
              <Button variant="secondary" onClick={() => void detail.refetch()}>
                Retry opening memory
              </Button>
            ) : null}
            {record ? (
              <>
                <RecordInformation record={record} openRecord={openRecord} />
                {record.conflictRecordIds.length ? (
                  <ConflictPanel
                    record={record}
                    live={Boolean(live)}
                    queryKey={queryKey}
                    actions={actions}
                    openRecord={openRecord}
                    resolve={(proposal, keep) =>
                      act({ ...identity(proposal), action: "resolve_conflict", keep })
                    }
                    editMine={editKeepingMine}
                  />
                ) : null}
                {live ? <MemorySwitches record={record} busy={actions.busy} act={act} /> : null}
                {trashed && !isTrashRoot(record) && record.trashGroupId ? (
                  <div className="flex flex-col items-start gap-2">
                    <p className="text-muted-foreground">
                      This memory moved to Trash with another memory. It restores or deletes with
                      that one.
                    </p>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => openRecord(record.trashGroupId as string)}
                    >
                      Open the memory it moved with
                    </Button>
                  </div>
                ) : null}
                <div className="flex flex-wrap items-start gap-2">
                  {trashed && isTrashRoot(record) ? (
                    <>
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={actions.busy}
                        onClick={() =>
                          void restoreMemory(actions, record, {
                            done: () => {
                              onChanged();
                              close();
                            },
                            refused: onChanged,
                          })
                        }
                      >
                        Restore
                      </Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        disabled={actions.busy}
                        onClick={() => setMode("delete")}
                      >
                        Delete now
                      </Button>
                    </>
                  ) : null}
                  {editable && (!record.ownerHeld || record.status === "disputed") ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={actions.busy}
                      onClick={() => act({ ...identity(record), action: "confirm" })}
                    >
                      Confirm memory
                    </Button>
                  ) : null}
                  {editable && record.status !== "disputed" ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={actions.busy}
                      onClick={() => act({ ...identity(record), action: "dispute" })}
                    >
                      Dispute memory
                    </Button>
                  ) : null}
                  {editable ? (
                    <>
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={actions.busy}
                        onClick={() => startEditor("workspace")}
                      >
                        Change workspace
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={actions.busy}
                        onClick={() => act({ ...identity(record), action: "archive" })}
                      >
                        <ArchiveIcon data-icon="inline-start" aria-hidden="true" />
                        Archive
                      </Button>
                    </>
                  ) : null}
                  {live && record.status === "archived" ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={actions.busy}
                      onClick={() => act({ ...identity(record), action: "unarchive" })}
                    >
                      Unarchive
                    </Button>
                  ) : null}
                  {/* A pending proposal is resolved, not trashed (R28). */}
                  {!trashed && record.status !== "proposed" ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={actions.busy}
                      onClick={() => setMode("trash")}
                    >
                      <TrashIcon data-icon="inline-start" aria-hidden="true" />
                      Move to Trash
                    </Button>
                  ) : null}
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={actions.busy}
                    aria-expanded={history}
                    onClick={() => setHistory(!history)}
                  >
                    <HistoryIcon data-icon="inline-start" aria-hidden="true" />
                    {history ? "Hide history" : "Show history"}
                  </Button>
                </div>
                {history ? (
                  <MemoryHistory record={record} queryKey={queryKey} actions={actions} />
                ) : null}
              </>
            ) : null}
          </div>
        ) : null}
        {mode === "edit" && draftRecord && !accessLost ? (
          <RecordEditor
            record={draftRecord}
            initialContent={selection.content}
            disabled={actions.busy || Boolean(conflict)}
            onSave={save}
            onInvalid={invalid}
            footer={back}
          />
        ) : null}
        {mode === "workspace" && draftRecord && !accessLost ? (
          <MemoryWorkspace
            record={draftRecord}
            disabled={actions.busy || Boolean(conflict)}
            onSave={save}
            onInvalid={invalid}
            footer={back}
          />
        ) : null}
        {mode === "trash" && record && !accessLost ? (
          <TrashConfirmation
            record={record}
            queryKey={queryKey}
            actions={actions}
            cancel={goBack}
            confirm={() => act({ ...identity(record), action: "trash" })}
          />
        ) : null}
        {mode === "delete" && !accessLost ? (
          <DeleteNowConfirmation
            // A placeholder from before a refresh may carry a stale Trash version.
            disabled={actions.busy || !record || detail.isPlaceholderData}
            cancel={goBack}
            confirm={deleteNow}
          />
        ) : null}
      </MemoryDialog>
      {conflict && !accessLost ? (
        <RecoveryRequest
          open
          title="Review the latest memory"
          description="Compare the saved revision with your submitted fields. If you continue and save again, the form applies your reviewed draft to that revision."
          actions={
            <>
              {!reviewed ? (
                <Button disabled={actions.busy} onClick={reviewLatest}>
                  Review latest memory
                </Button>
              ) : null}
              {reviewed &&
              (mode === "edit" || mode === "workspace") &&
              reviewed.status !== "superseded" ? (
                <Button
                  variant="secondary"
                  disabled={actions.busy}
                  onClick={() => {
                    cache.setQueryData(detailKey, reviewed);
                    setLocalRecord(reviewed);
                    setDraftRecord(reviewed);
                    setConflict(null);
                  }}
                >
                  {mode === "edit" ? "Keep editing" : "Keep editing the workspace"}
                </Button>
              ) : null}
              <Button
                variant={reviewed ? "default" : "secondary"}
                disabled={actions.busy}
                onClick={() => {
                  if (reviewed) {
                    cache.setQueryData(detailKey, reviewed);
                    setLocalRecord(reviewed);
                  }
                  goBack();
                  setConflict(null);
                }}
              >
                {reviewed ? "Use latest memory" : "Back to memory"}
              </Button>
            </>
          }
        >
          {reviewed ? (
            <div className="grid min-w-0 gap-4 [overflow-wrap:anywhere]">
              <section aria-label="Current claim" className="grid gap-2">
                <h3 className="font-medium">Current revision {reviewed.revision}</h3>
                <MemoryFields
                  fields={[
                    ...memoryClaimFields(memoryContent(reviewed)),
                    ...memoryUseFields(reviewed),
                  ]}
                />
              </section>
              <section aria-label="Submitted change" className="grid gap-2">
                <h3 className="font-medium">Your submitted change</h3>
                <MemoryFields fields={submittedFields(conflict)} />
              </section>
            </div>
          ) : null}
        </RecoveryRequest>
      ) : null}
    </>
  );
}
