import {
  type KnowledgeForgetPreview,
  type KnowledgeLifecycleInput,
  type KnowledgeMutationInput,
  type KnowledgeRecord,
  type KnowledgeSource,
  knowledgeLifecycleInputSchema,
} from "@personal-os/domain";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useCallback, useId, useLayoutEffect, useRef, useState } from "react";
import { api } from "@/api";
import { QueryFeedback } from "@/components/async-state";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { type MemoryActions, memoryErrorStatus, useMemoryWriteKey } from "./actions";
import {
  memoryAcceptance,
  memoryContent,
  memoryLabel,
  memoryState,
  memorySummary,
} from "./presentation";
import { MemoryRestrictions, memoryClaimFields, RecordEditor } from "./record-editor";

type Purpose = KnowledgeRecord["purposes"][number];
type DetailMode = "detail" | "edit" | "restrict" | "supersede" | "forget";
type Preview = { page: KnowledgeForgetPreview; mutationKey: string; offset: number };
type Selection = { id: string; purpose: Purpose };

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

export function MemoryBadges({ record }: { record: KnowledgeRecord }) {
  return (
    <span className="flex min-w-0 flex-wrap gap-1">
      <Badge variant="secondary">{memoryLabel(record.origin)}</Badge>
      <Badge variant="secondary">{memoryState(record)}</Badge>
      {record.conflictRecordIds.length ? <Badge variant="secondary">Conflict</Badge> : null}
    </span>
  );
}

function dateLabel(value: string) {
  return new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
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
    ["Workspace", record.scope.workspace ? memoryLabel(record.scope.workspace) : "All workspaces"],
    ["Allowed uses", record.purposes.map(memoryLabel).join(", ")],
    ["Visibility", record.sensitivity === "sensitive" ? "Only you" : "Authorized agents"],
  ];
}

function submittedFields(input: KnowledgeLifecycleInput): Array<[string, string]> {
  if (input.action === "revise") return memoryClaimFields(input.content);
  if (input.action === "supersede") return [["Replacement memory ID", input.replacementId]];
  if (input.action === "restrict") {
    const { scope, purposes, sensitivity } = input.restrictions;
    return [
      ...(scope
        ? [
            ["Workspace", scope.workspace ? memoryLabel(scope.workspace) : "All workspaces"] as [
              string,
              string,
            ],
          ]
        : []),
      ...(purposes
        ? [["Allowed uses", purposes.map(memoryLabel).join(", ")] as [string, string]]
        : []),
      ...(sensitivity
        ? [
            ["Visibility", sensitivity === "sensitive" ? "Only you" : "Authorized agents"] as [
              string,
              string,
            ],
          ]
        : []),
    ];
  }
  return [["Action", input.action === "confirm" ? "Confirm memory" : "Dispute memory"]];
}

function SourceEvidence({
  source,
  openRecord,
}: {
  source: KnowledgeSource;
  openRecord?: (id: string) => void;
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
    case "first_party_selection":
      return (
        <span>
          Selection <code>{evidence.id}</code>
        </span>
      );
  }
}

function RecordSources({
  sources,
  openRecord,
}: {
  sources: KnowledgeRecord["sources"];
  openRecord?: (id: string) => void;
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
  openRecord: (id: string) => void;
}) {
  const content = memoryContent(record);
  const summary = memorySummary(content);
  const selectionCount = record.sources.filter(
    (source) => source.classification === "first_party_selection" && !source.availability,
  ).length;
  const data: Array<[string, string]> = [
    ["Acceptance", memoryAcceptance(record)],
    ["Contributor", record.author.actorType === "user" ? "You" : `Agent ${record.author.actorId}`],
    ...memoryUseFields(record),
    ["Added", dateLabel(record.createdAt)],
  ];
  if (record.acceptance?.kind !== "evidence_rule" && selectionCount)
    data.push(["Supporting selections", String(selectionCount)]);
  if (record.acceptance) data.push(["Accepted", dateLabel(record.acceptance.acceptedAt)]);
  if (record.validFrom) data.push(["Available from", dateLabel(record.validFrom)]);
  if (record.validUntil) data.push(["Available until", dateLabel(record.validUntil)]);
  if (record.reviewAt) data.push(["Review date", dateLabel(record.reviewAt)]);
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
      </div>
      <MemoryFields fields={data} />
      <section aria-label="Sources" className="flex flex-col gap-2">
        <h3 className="font-medium">Sources</h3>
        <RecordSources sources={record.sources} openRecord={openRecord} />
      </section>
      {record.conflictRecordIds.length || record.supersededBy || record.relatedRecordIds.length ? (
        <section aria-label="Related memory" className="flex flex-col items-start gap-2">
          {record.conflictRecordIds.map((id, index) => (
            <Button key={id} variant="secondary" size="sm" onClick={() => openRecord(id)}>
              Open conflicting memory {index + 1}
            </Button>
          ))}
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
  purpose,
  queryKey,
  actions,
}: {
  record: KnowledgeRecord;
  purpose: Purpose;
  queryKey: readonly unknown[];
  actions: MemoryActions;
}) {
  const history = useInfiniteQuery({
    queryKey: [...queryKey, "history", record.id, record.revision, purpose],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) => {
      signal.throwIfAborted();
      return actions.read(
        () =>
          api.getKnowledgeHistory({
            recordId: record.id,
            purpose,
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
              <p className="text-muted-foreground">{memoryAcceptance(revision)}</p>
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

function SupersedeForm({
  disabled,
  onSubmit,
  cancel,
}: {
  disabled: boolean;
  onSubmit: (id: string) => void;
  cancel: ReactNode;
}) {
  const id = useId();
  const [replacement, setReplacement] = useState("");
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (!disabled) onSubmit(replacement.trim());
      }}
    >
      <Field>
        <FieldLabel htmlFor={id}>Replacement memory ID</FieldLabel>
        <Input
          id={id}
          value={replacement}
          onChange={(event) => setReplacement(event.target.value)}
          disabled={disabled}
        />
      </Field>
      <div className="grid gap-2 sm:grid-cols-2">
        {cancel}
        <Button type="submit" disabled={disabled || !replacement.trim()}>
          Supersede memory
        </Button>
      </div>
    </form>
  );
}

export function NewMemory({
  purpose,
  actions,
  close,
  restoreFocus,
  onSaved,
}: {
  purpose: Purpose;
  actions: MemoryActions;
  close: () => void;
  restoreFocus: () => void;
  onSaved: () => void;
}) {
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
        return {
          message:
            result.outcome === "pending_owner_review"
              ? "Memory saved for review."
              : result.outcome === "forgotten"
                ? "This memory is unavailable."
                : "Memory saved.",
        };
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
        purpose={purpose}
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
  onForget,
}: {
  selection: Selection;
  queryKey: readonly unknown[];
  actions: MemoryActions;
  close: () => void;
  restoreFocus: () => void;
  openRecord: (id: string) => void;
  onChanged: () => void;
  onForget: (operationId: string | null, toastId: string) => void;
}) {
  const { id, purpose } = selection;
  const retryableInput = useMemoryWriteKey();
  const cache = useQueryClient();
  const detailKey = [...queryKey, "record", id, purpose];
  const detail = useQuery({
    queryKey: detailKey,
    queryFn: ({ signal }) => {
      signal.throwIfAborted();
      return actions.read(() => api.getKnowledge({ id, purpose }));
    },
    retry: false,
  });
  const [mode, setMode] = useState<DetailMode>("detail");
  const [localRecord, setLocalRecord] = useState<KnowledgeRecord | null>(null);
  const [draftRecord, setDraftRecord] = useState<KnowledgeRecord | null>(null);
  const [history, setHistory] = useState(false);
  const [conflict, setConflict] = useState<KnowledgeLifecycleInput | null>(null);
  const [reviewed, setReviewed] = useState<KnowledgeRecord | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewStale, setPreviewStale] = useState(false);
  const [previousPages, setPreviousPages] = useState<Preview[]>([]);
  const accessLost = [401, 403, 404].includes(memoryErrorStatus(detail.error) ?? 0);
  const record = accessLost ? undefined : (detail.data ?? localRecord);

  const summary = record && memorySummary(memoryContent(record));
  const mutable = record && record.status !== "superseded";

  function save(input: KnowledgeMutationInput | KnowledgeLifecycleInput) {
    if (!("action" in input)) return;
    void actions.run({
      pending: input.action === "revise" ? "Saving memory…" : "Updating memory…",
      failure: "Couldn’t confirm this update. Review the latest memory before trying again.",
      request: () => api.updateKnowledge(retryableInput(input)),
      complete: (result) => {
        setMode("detail");
        setDraftRecord(null);
        onChanged();
        if (result.outcome === "readable" && result.record.purposes.includes(purpose)) {
          setLocalRecord(result.record);
        } else {
          close();
        }
        const messages = {
          revise: "Memory saved.",
          confirm: "Memory confirmed.",
          dispute: "Memory disputed.",
          restrict: "Memory use restricted.",
          supersede: "Memory superseded.",
        };
        return {
          message:
            result.outcome === "pending_owner_review"
              ? "Memory saved for review."
              : result.outcome === "readable"
                ? messages[input.action]
                : "This memory is unavailable.",
        };
      },
      recover: (error) => {
        if (memoryErrorStatus(error) !== 409) return undefined;
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
      request: () => api.getKnowledge({ id, purpose }),
      complete: (current) => {
        setReviewed(current);
        return undefined;
      },
      recover: (error) => {
        if (![401, 403, 404].includes(memoryErrorStatus(error) ?? 0)) return undefined;
        close();
        return "This memory is no longer available for the selected use.";
      },
    });
  }

  function action(action: "confirm" | "dispute" | "supersede", replacementId?: string) {
    const target = action === "supersede" ? draftRecord : record;
    if (!target) return;
    const parsed = knowledgeLifecycleInputSchema.safeParse({
      action,
      recordId: id,
      expectedRevision: target.revision,
      mutationKey: crypto.randomUUID(),
      ...(replacementId !== undefined ? { replacementId } : {}),
    });
    if (!parsed.success) {
      actions.notifyError("Enter a valid replacement memory ID.");
      return;
    }
    save(parsed.data);
  }

  function loadPreview(next = false) {
    const cursor = next ? preview?.page.nextCursor : undefined;
    void actions.run({
      pending: "Checking what will be forgotten…",
      failure: "Couldn’t load the forgetting preview.",
      request: () => api.previewKnowledgeForget({ recordId: id, ...(cursor ? { cursor } : {}) }),
      complete: (page) => {
        if (next && preview) setPreviousPages((pages) => [...pages, preview]);
        else setPreviousPages([]);
        setPreview({
          page,
          mutationKey: next && preview ? preview.mutationKey : crypto.randomUUID(),
          offset: next && preview ? preview.offset + preview.page.affected.length : 0,
        });
        setPreviewStale(false);
        setMode("forget");
        return undefined;
      },
      recover: (error) => {
        if (memoryErrorStatus(error) !== 409) return undefined;
        setPreviewStale(true);
        return "This preview changed. Refresh it before forgetting.";
      },
    });
  }

  function forget() {
    if (!preview || previewStale) return;
    void actions.run({
      pending: "Submitting forgetting request…",
      failure: "Couldn’t confirm the forgetting request. You can retry this preview.",
      request: () =>
        api.forgetKnowledge({
          previewId: preview.page.previewId,
          ownerEpoch: preview.page.ownerEpoch,
          mutationKey: preview.mutationKey,
        }),
      complete: (result, toastId) => {
        if (result.outcome === "pending_erasure") {
          onForget(result.operationId, toastId);
          return {
            message: "Forgetting in progress.",
            tone: "info",
            persistent: true,
            description: "Memory will be available again when erasure finishes.",
          };
        }
        if (result.outcome === "forgotten") {
          onForget(null, toastId);
          return { message: "Memory forgotten." };
        }
        return { message: "Couldn’t confirm erasure.", tone: "info" };
      },
      recover: (error) => {
        if (memoryErrorStatus(error) === 409 || memoryErrorStatus(error) === 404) {
          setPreviewStale(true);
          return "This preview changed. Refresh it before forgetting.";
        }
        return memoryErrorStatus(error) === 503
          ? "Forgetting is temporarily unavailable."
          : undefined;
      },
    });
  }

  function startEditor(next: "edit" | "restrict" | "supersede") {
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
  const title =
    mode === "edit"
      ? "Edit memory"
      : mode === "restrict"
        ? "Restrict memory use"
        : mode === "supersede"
          ? "Supersede memory"
          : mode === "forget"
            ? "Forget memory?"
            : summary && summary.title.length <= 80
              ? summary.title
              : "Memory details";
  const description =
    mode === "edit"
      ? "Save your correction as a new revision."
      : mode === "restrict"
        ? "Limit where and why this memory can be used."
        : mode === "supersede"
          ? "Choose the saved memory that should replace this one."
          : mode === "forget"
            ? "This permanently erases this memory, its revision history, and copies derived from it."
            : record
              ? `${memoryLabel(memoryContent(record).kind)} · revision ${record.revision}`
              : "View the saved record.";

  return (
    <>
      <MemoryDialog
        title={title}
        description={description}
        busy={actions.busy}
        close={mode === "detail" || accessLost ? close : goBack}
        restoreFocus={restoreFocus}
        safe={mode === "forget"}
        showFooter={accessLost || mode === "forget" || mode === "detail"}
        footer={
          accessLost ? undefined : mode === "forget" ? (
            <Button
              variant="destructive"
              disabled={actions.busy || previewStale}
              onClick={forget}
              className="flex-1"
            >
              Forget permanently
            </Button>
          ) : mode === "detail" ? (
            mutable ? (
              <Button
                disabled={actions.busy}
                variant="secondary"
                onClick={() => startEditor("edit")}
                className="flex-1"
              >
                Edit memory
              </Button>
            ) : (
              <Button
                disabled={actions.busy || !record}
                variant="destructive"
                onClick={() => loadPreview()}
                className="flex-1"
              >
                Preview forgetting
              </Button>
            )
          ) : undefined
        }
      >
        {mode === "detail" || accessLost ? (
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
                <div className="flex flex-wrap items-start gap-2">
                  {mutable ? (
                    <>
                      {record.status !== "active" || record.stale ? (
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled={actions.busy}
                          onClick={() => action("confirm")}
                        >
                          Confirm memory
                        </Button>
                      ) : null}
                      {record.status !== "disputed" ? (
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled={actions.busy}
                          onClick={() => action("dispute")}
                        >
                          {record.status === "proposed" ? "Reject proposal" : "Dispute memory"}
                        </Button>
                      ) : null}
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={actions.busy}
                        onClick={() => startEditor("supersede")}
                      >
                        Supersede
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={actions.busy}
                        onClick={() => startEditor("restrict")}
                      >
                        Restrict use
                      </Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        disabled={actions.busy}
                        onClick={() => loadPreview()}
                      >
                        Preview forgetting
                      </Button>
                    </>
                  ) : null}
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={actions.busy}
                    aria-expanded={history}
                    onClick={() => setHistory(!history)}
                  >
                    {history ? "Hide history" : "Show history"}
                  </Button>
                </div>
                {history ? (
                  <MemoryHistory
                    record={record}
                    purpose={purpose}
                    queryKey={queryKey}
                    actions={actions}
                  />
                ) : null}
              </>
            ) : null}
          </div>
        ) : null}
        {mode === "edit" && draftRecord && !accessLost ? (
          <RecordEditor
            record={draftRecord}
            purpose={purpose}
            disabled={actions.busy || Boolean(conflict)}
            onSave={save}
            onInvalid={invalid}
            footer={back}
          />
        ) : null}
        {mode === "restrict" && draftRecord && !accessLost ? (
          <MemoryRestrictions
            record={draftRecord}
            disabled={actions.busy || Boolean(conflict)}
            onSave={save}
            onInvalid={invalid}
            footer={back}
          />
        ) : null}
        {mode === "supersede" && !accessLost ? (
          <SupersedeForm
            disabled={actions.busy || Boolean(conflict)}
            cancel={back}
            onSubmit={(replacementId) => action("supersede", replacementId)}
          />
        ) : null}
        {mode === "forget" && preview && !accessLost ? (
          <div className="flex flex-col gap-3">
            <ul className="flex flex-col gap-1">
              <li>
                {preview.page.dependentCopyCount} dependent{" "}
                {preview.page.dependentCopyCount === 1 ? "copy" : "copies"}
              </li>
              <li>
                {preview.page.historyCount} saved{" "}
                {preview.page.historyCount === 1 ? "revision" : "revisions"}
              </li>
            </ul>
            <p>
              Original source material, independent memories, and files you already downloaded stay
              where they are.
            </p>
            <details>
              <summary>
                Affected memories {preview.offset + 1}–
                {preview.offset + preview.page.affected.length}
              </summary>
              <ul className="mt-2 flex flex-col gap-1 text-muted-foreground">
                {preview.page.affected.map(({ recordId, revision }) => (
                  <li key={`${recordId}:${revision}`}>
                    {recordId === id ? "This memory" : recordId} · revision {revision}
                  </li>
                ))}
              </ul>
            </details>
            <div className="flex flex-wrap gap-2">
              {previewStale ? (
                <Button variant="secondary" disabled={actions.busy} onClick={() => loadPreview()}>
                  Refresh preview
                </Button>
              ) : null}
              {previousPages.length && !previewStale ? (
                <Button
                  variant="secondary"
                  disabled={actions.busy}
                  onClick={() => {
                    const previous = previousPages.at(-1);
                    if (previous) setPreview(previous);
                    setPreviousPages((pages) => pages.slice(0, -1));
                  }}
                >
                  Previous affected memories
                </Button>
              ) : null}
              {preview.page.nextCursor && !previewStale ? (
                <Button
                  variant="secondary"
                  disabled={actions.busy}
                  onClick={() => loadPreview(true)}
                >
                  More affected memories
                </Button>
              ) : null}
            </div>
          </div>
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
              (mode === "edit" || mode === "restrict" || mode === "supersede") &&
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
                  {mode === "edit"
                    ? "Keep editing"
                    : mode === "restrict"
                      ? "Keep editing restrictions"
                      : "Keep replacement"}
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
                <MemoryBadges record={reviewed} />
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
