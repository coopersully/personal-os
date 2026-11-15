import type { KnowledgePage, KnowledgeQuery, KnowledgeRecord } from "@personal-os/domain";
import {
  knowledgeContentSchema,
  knowledgePurposeSchema,
  knowledgeQuerySchema,
  knowledgeWorkspaceSchema,
} from "@personal-os/domain";
import { CancelledError, useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { api } from "@/api";
import { QueryFeedback } from "@/components/async-state";
import { useConfirmAction } from "@/components/confirm-action";
import { ChevronRightIcon, DownloadIcon, PlusIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SettingsSection } from "../settings/settings-layout";
import {
  type PreferenceSession,
  usePreferenceSession,
} from "../workspace-settings/account-save-session";
import { memoryKey, registerMemoryCleanup, useMemoryActions } from "./actions";
import { LearningSettings, PreferenceSelection } from "./learning-settings";
import { memoryAcceptance, memoryContent, memoryLabel, memorySummary } from "./presentation";
import { MemoryBadges, MemoryRecordDetail, NewMemory } from "./record-detail";

type View = "accepted" | "review" | "conflicts" | "all";
type FilterStatus = NonNullable<KnowledgeQuery["status"]> | "stale";
type Filters = Pick<KnowledgeQuery, "purpose" | "workspace" | "kind" | "text">;
type Erasure = { operationId: string; status: "pending" | "blocked"; toastId?: string };
const statuses: FilterStatus[] = [
  "active",
  "proposed",
  "disputed",
  "stale",
  "expired",
  "superseded",
];
const reviewStatuses: FilterStatus[] = ["proposed", "disputed", "stale"];
const conflictStatuses: FilterStatus[] = ["active", ...reviewStatuses];

function statusLabel(status: FilterStatus) {
  if (status === "active") return "Accepted";
  if (status === "stale") return "Review due";
  return memoryLabel(status);
}

function listScope(view: View, status: FilterStatus | "", filters: Filters): KnowledgeQuery {
  return {
    ...filters,
    ...(status && status !== "stale" ? { status } : {}),
    ...(view === "conflicts" ? { hasConflict: true } : {}),
    ...(view === "accepted"
      ? { reviewView: "accepted" }
      : status === "stale"
        ? { reviewView: "review_due" }
        : view === "review"
          ? { reviewView: "needs_review" }
          : {}),
  };
}

export function MemoryPage({ ownerId }: { ownerId: string }) {
  const client = useQueryClient();
  const session = usePreferenceSession(client);
  registerMemoryCleanup(client);
  if (session.owner !== ownerId) return null;
  return <OwnerMemory key={`${ownerId}:${session.epoch}`} session={session} ownerId={ownerId} />;
}

function OwnerMemory({ session, ownerId }: { session: PreferenceSession; ownerId: string }) {
  const cache = useQueryClient();
  const operationActions = useMemoryActions(session);
  const viewId = useId();
  const [view, setView] = useState<View>("accepted");
  const [status, setStatus] = useState<FilterStatus | "">("");
  const [searchText, setSearchText] = useState("");
  const [filters, setFilters] = useState<Filters>({ purpose: "planning" });
  const [filterVersion, setFilterVersion] = useState(0);
  const [generation, setGeneration] = useState(0);
  const [selection, setSelection] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [tracked, setTracked] = useState<Erasure | null>(null);
  const [exportPosition, setExportPosition] = useState<{ cursor?: string; page: number }>({
    page: 1,
  });
  const origin = useRef<HTMLElement | null>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const contentSuspended = useRef(false);
  const [discovering, setDiscovering] = useState(false);
  const seenEpoch = useRef<number>(undefined);
  const sessionKey = [...memoryKey, ownerId, session.epoch];
  const queryKey = [...sessionKey, "content", generation];

  // Each visit starts with fresh authorization; no Memory data remains after leaving.
  useLayoutEffect(() => {
    return () => cache.removeQueries({ queryKey: [...memoryKey, ownerId, session.epoch] });
  }, [cache, ownerId, session.epoch]);

  const clearContent = useCallback(() => {
    cache.removeQueries({ queryKey: [...memoryKey, ownerId, session.epoch, "content"] });
    setGeneration((value) => value + 1);
    setSelection(null);
    setAdding(false);
    setSearchText("");
    setFilters((previous) => ({ ...previous, text: undefined }));
    setExportPosition({ page: 1 });
  }, [cache, ownerId, session.epoch]);

  function suspendContent() {
    contentSuspended.current = true;
    seenEpoch.current = undefined;
    clearContent();
  }

  const actions = useMemoryActions(session, {
    canPublish: () => !contentSuspended.current,
    onRevalidate: (reason) => {
      suspendContent();
      setDiscovering(true);
      if (reason === "cursor")
        operationActions.notifyError(
          "This memory page expired or changed. Reloading saved memory.",
        );
    },
  });

  function refresh() {
    cache.removeQueries({ queryKey });
    setGeneration((value) => value + 1);
    seenEpoch.current = undefined;
    setExportPosition({ page: 1 });
  }

  const active = useQuery({
    queryKey: [...sessionKey, "erasure"],
    queryFn: async ({ signal }) => {
      signal.throwIfAborted();
      const operations = await api.listActiveKnowledgeForgetOperations();
      signal.throwIfAborted();
      if (!operationActions.isCurrent()) throw new CancelledError({ silent: true });
      if (operations[0]) {
        if (!contentSuspended.current) {
          actions.invalidate();
          suspendContent();
        }
        setTracked((previous) => previous ?? operations[0] ?? null);
      }
      return operations;
    },
    staleTime: 0,
    retry: false,
  });
  const erasure = tracked ?? active.data?.[0];
  const { refetch: discoverErasure } = active;
  const checkErasure = useCallback(async () => {
    const result = await discoverErasure();
    if (!operationActions.isCurrent() || !result.isSuccess) return;
    if (!result.data?.length) contentSuspended.current = false;
    setDiscovering(false);
  }, [discoverErasure, operationActions.isCurrent]);
  useEffect(() => {
    if (discovering) void checkErasure();
  }, [discovering, checkErasure]);

  const statusRead = useQuery({
    queryKey: [...sessionKey, "operation", erasure?.operationId],
    queryFn: ({ signal }) => {
      signal.throwIfAborted();
      if (!erasure) throw new Error("Missing erasure operation.");
      return api.getKnowledgeForgetStatus({ operationId: erasure.operationId });
    },
    enabled: Boolean(erasure),
    refetchInterval: (query) => (query.state.data?.status === "completed" ? false : 4000),
    refetchIntervalInBackground: false,
    retry: false,
  });

  useEffect(() => {
    if (!erasure || statusRead.data?.status !== "completed" || !operationActions.isCurrent())
      return;
    if (tracked?.toastId)
      operationActions.finishToast(tracked.toastId, { message: "Memory forgotten." });
    cache.setQueryData([...memoryKey, ownerId, session.epoch, "erasure"], []);
    setTracked(null);
    contentSuspended.current = false;
    setDiscovering(false);
    seenEpoch.current = undefined;
    cache.removeQueries({ queryKey: [...memoryKey, ownerId, session.epoch, "content"] });
    setGeneration((value) => value + 1);
  }, [
    statusRead.data,
    erasure,
    tracked,
    operationActions.isCurrent,
    operationActions.finishToast,
    cache,
    ownerId,
    session.epoch,
  ]);

  const phase = statusRead.data?.status ?? erasure?.status;
  const erasureToast = tracked?.toastId;
  useEffect(() => {
    if (phase === "blocked" && erasureToast)
      operationActions.finishToast(erasureToast, {
        message: "Erasure needs attention.",
        tone: "error",
        persistent: true,
        description: "Memory remains unavailable. You can request another attempt.",
      });
  }, [phase, erasureToast, operationActions.finishToast]);

  const contentReady = active.isSuccess && !erasure && !discovering && !contentSuspended.current;
  const query = listScope(view, status, filters);
  const records = useInfiniteQuery({
    queryKey: [...queryKey, "list", filterVersion],
    queryFn: async ({ pageParam, signal }) => {
      signal.throwIfAborted();
      const page = await actions.read(
        () => api.searchKnowledge({ ...query, ...(pageParam ? { cursor: pageParam } : {}) }),
        pageParam,
      );
      signal.throwIfAborted();
      const changed = seenEpoch.current !== undefined && seenEpoch.current !== page.epoch;
      seenEpoch.current = page.epoch;
      if (changed) {
        actions.invalidate();
        clearContent();
        throw new CancelledError({ silent: true });
      }
      return page;
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    enabled: contentReady,
    retry: false,
  });
  const listEpoch = records.data?.pages[0]?.epoch;

  const close = () => {
    setSelection(null);
    setAdding(false);
  };
  function focusInvoker() {
    if (!actions.isCurrent()) return;
    const target = origin.current?.isConnected ? origin.current : addButton.current;
    target?.focus();
  }
  function openRecord(id: string, trigger?: HTMLElement) {
    if (trigger) origin.current = trigger;
    setSelection(id);
  }
  function changeFilters(patch: Partial<Filters>) {
    setFilters((previous) => ({ ...previous, ...patch }));
    setFilterVersion((version) => version + 1);
  }

  function onForget(operationId: string | null, toastId: string) {
    if (operationId) {
      actions.invalidate(toastId);
      suspendContent();
      setTracked({ operationId, status: "pending", toastId });
    } else {
      close();
      refresh();
      void active.refetch();
    }
  }

  function retryErasure(operationId: string) {
    void operationActions.run({
      pending: "Requesting another erasure attempt…",
      failure: "Couldn’t retry erasure. Memory remains unavailable while erasure is unfinished.",
      request: () => api.retryKnowledgeForget({ operationId }),
      complete: (result, toastId) => {
        if (tracked?.toastId) toast.dismiss(tracked.toastId);
        cache.setQueryData([...sessionKey, "operation", operationId], result);
        if (result.status === "completed") {
          setTracked({ operationId, status: "pending" });
          return { message: "Memory forgotten." };
        }
        setTracked({ operationId, status: result.status, toastId });
        return {
          message:
            result.status === "blocked" ? "Erasure needs attention." : "Erasure retry requested.",
          tone: result.status === "blocked" ? "error" : "info",
          persistent: true,
        };
      },
    });
  }

  const { confirm, confirmation } = useConfirmAction();
  function download() {
    confirm({
      intent: "default",
      title: "Download memory?",
      description:
        "This saves a JSON file containing up to 50 available memory revisions on this device. Copies you download stay on this device when you forget memory in nohmi.",
      actionLabel: "Download",
      onConfirm: () =>
        void actions.run({
          pending: "Preparing memory download…",
          failure: "Memory export is unavailable. Try again later.",
          request: () =>
            actions.read(
              () =>
                api.exportKnowledge(exportPosition.cursor ? { cursor: exportPosition.cursor } : {}),
              exportPosition.cursor,
            ),
          complete: (page: KnowledgePage, toastId) => {
            if (seenEpoch.current !== undefined && seenEpoch.current !== page.epoch) {
              actions.invalidate(toastId);
              seenEpoch.current = undefined;
              clearContent();
              return {
                message: "Memory changed. Start a new download from the first page.",
                tone: "error",
              };
            }
            if (page.state === "unavailable")
              return {
                message: "Memory export is unavailable because its sources are unavailable.",
                tone: "error",
              };
            if (!page.items.length)
              return { message: "No available memory to download.", tone: "info" };
            const url = URL.createObjectURL(
              new Blob(
                [
                  JSON.stringify(
                    {
                      schemaVersion: page.schemaVersion,
                      state: page.state,
                      items: page.items,
                    },
                    null,
                    2,
                  ),
                ],
                { type: "application/json" },
              ),
            );
            try {
              const link = document.createElement("a");
              link.href = url;
              link.download = `nohmi-memory-${exportPosition.page}.json`;
              link.click();
            } finally {
              setTimeout(() => URL.revokeObjectURL(url), 1000);
            }
            setExportPosition(
              page.nextCursor
                ? { cursor: page.nextCursor, page: exportPosition.page + 1 }
                : { page: 1 },
            );
            return {
              message: "Memory download started.",
              ...(page.state === "partial"
                ? {
                    description:
                      "The file includes available revisions. Some sources are unavailable.",
                  }
                : {}),
            };
          },
        }),
    });
  }

  const items = records.data?.pages.flatMap((page) => page.items) ?? [];
  const pageAvailability = records.data?.pages[0]?.state;

  return (
    <div className="settings-stack">
      <QueryFeedback query={active} title="Couldn’t check for unfinished forgetting." />
      {active.isError && !erasure ? (
        <SettingsSection title="Memory Availability">
          <Button variant="secondary" onClick={() => void checkErasure()}>
            Retry checking memory availability
          </Button>
        </SettingsSection>
      ) : null}
      {(active.isPending || (discovering && !active.isError)) && !erasure ? (
        <Spinner aria-label="Checking memory availability" />
      ) : null}
      {erasure ? (
        <SettingsSection title="Forgetting">
          <div className="flex min-w-0 flex-col items-start gap-3">
            <p>
              {phase === "blocked"
                ? "Memory access is paused during erasure."
                : "Memory is unavailable while erasure runs."}
            </p>
            <QueryFeedback query={statusRead} title="Couldn’t check erasure status." />
            {phase === "blocked" ? (
              <Button
                key="retry-erasure"
                variant="secondary"
                disabled={operationActions.busy}
                onClick={() => retryErasure(erasure.operationId)}
              >
                Retry erasure
              </Button>
            ) : (
              <Button
                key="check-erasure"
                variant="secondary"
                disabled={statusRead.isFetching}
                onClick={() =>
                  void operationActions.run({
                    pending: "Checking erasure status…",
                    failure: "Couldn’t check erasure status.",
                    request: async () => (await statusRead.refetch({ throwOnError: true })).data,
                    complete: (result) => {
                      if (tracked?.toastId) return undefined;
                      if (result?.status === "pending")
                        return { message: "Erasure is still in progress.", tone: "info" };
                      if (result?.status === "blocked")
                        return { message: "Erasure needs attention.", tone: "error" };
                      if (result?.status === "completed") return { message: "Memory forgotten." };
                    },
                  })
                }
              >
                Check erasure status
              </Button>
            )}
          </div>
        </SettingsSection>
      ) : null}
      {contentReady ? (
        <>
          <SettingsSection title="Saved Memory">
            <div className="flex min-w-0 flex-col gap-4">
              <div className="flex flex-wrap gap-2">
                <Button
                  ref={addButton}
                  disabled={actions.busy}
                  onClick={(event) => {
                    origin.current = event.currentTarget;
                    setAdding(true);
                  }}
                >
                  <PlusIcon data-icon="inline-start" aria-hidden="true" />
                  Add memory
                </Button>
                <Button variant="secondary" disabled={actions.busy} onClick={download}>
                  <DownloadIcon data-icon="inline-start" aria-hidden="true" />
                  {exportPosition.cursor ? "Download next page" : "Download memory"}
                </Button>
              </div>
              <Tabs
                value={view}
                onValueChange={(value) => {
                  const next = value as View;
                  setView(next);
                  setStatus("");
                  setFilterVersion((version) => version + 1);
                }}
              >
                <TabsList
                  aria-label="Memory views"
                  className="max-w-full flex-wrap justify-start group-data-horizontal/tabs:h-auto [&>[role=tab]]:h-auto"
                >
                  <TabsTrigger value="accepted">Accepted</TabsTrigger>
                  <TabsTrigger value="review">Needs review</TabsTrigger>
                  <TabsTrigger value="conflicts">Conflicts</TabsTrigger>
                  <TabsTrigger value="all">All memory</TabsTrigger>
                </TabsList>
                <TabsContent value={view} className="flex min-w-0 flex-col gap-3">
                  <form
                    className="flex flex-wrap items-end gap-2"
                    onSubmit={(event) => {
                      event.preventDefault();
                      const text = searchText.trim();
                      const parsed = knowledgeQuerySchema.safeParse({
                        ...filters,
                        text: text || undefined,
                      });
                      if (!parsed.success) {
                        actions.notifyError("Enter a valid memory search.");
                        return;
                      }
                      if ((filters.text ?? "") !== text) changeFilters({ text: text || undefined });
                    }}
                  >
                    <Field className="min-w-0 flex-1">
                      <FieldLabel htmlFor={`${viewId}-search`}>Search memory</FieldLabel>
                      <Input
                        id={`${viewId}-search`}
                        type="search"
                        autoComplete="off"
                        maxLength={500}
                        value={searchText}
                        onChange={(event) => setSearchText(event.target.value)}
                      />
                    </Field>
                    <Button type="submit" variant="secondary">
                      Search
                    </Button>
                    {filters.text ? (
                      <Button
                        variant="ghost"
                        onClick={() => {
                          setSearchText("");
                          changeFilters({ text: undefined });
                        }}
                      >
                        Clear search
                      </Button>
                    ) : null}
                  </form>
                  <FieldGroup className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,8rem),1fr))] gap-2">
                    <MemoryFilter
                      id={`${viewId}-purpose`}
                      label="Use"
                      value={filters.purpose}
                      options={knowledgePurposeSchema.options}
                      onChange={(purpose) =>
                        changeFilters({ purpose: purpose as Filters["purpose"] })
                      }
                    />
                    <MemoryFilter
                      id={`${viewId}-workspace`}
                      label="Workspace"
                      value={filters.workspace ?? ""}
                      options={knowledgeWorkspaceSchema.options}
                      all="All workspaces"
                      onChange={(workspace) =>
                        changeFilters({
                          workspace: (workspace || undefined) as Filters["workspace"],
                        })
                      }
                    />
                    <MemoryFilter
                      id={`${viewId}-kind`}
                      label="Type"
                      value={filters.kind ?? ""}
                      options={knowledgeContentSchema.options.map(
                        (option) => option.shape.kind.value,
                      )}
                      all="All types"
                      onChange={(kind) =>
                        changeFilters({ kind: (kind || undefined) as Filters["kind"] })
                      }
                    />
                    {view !== "accepted" ? (
                      <MemoryFilter
                        id={`${viewId}-status`}
                        label="Status"
                        value={status}
                        options={
                          view === "review"
                            ? reviewStatuses
                            : view === "conflicts"
                              ? conflictStatuses
                              : statuses
                        }
                        all="All statuses"
                        optionLabel={(value) => statusLabel(value as FilterStatus)}
                        onChange={(value) => {
                          setStatus(value as FilterStatus | "");
                          setFilterVersion((version) => version + 1);
                        }}
                      />
                    ) : null}
                  </FieldGroup>
                  <QueryFeedback query={records} title="Couldn’t load memory." />
                  {records.isPending ? <Spinner aria-label="Loading saved memory" /> : null}
                  {records.isError && !records.data ? (
                    <Button variant="secondary" className="w-fit" onClick={refresh}>
                      Retry loading memory
                    </Button>
                  ) : null}
                  {pageAvailability !== undefined && pageAvailability !== "available" ? (
                    <p className="text-sm text-muted-foreground">
                      {pageAvailability === "partial"
                        ? "Some memories are unavailable because their sources are unavailable."
                        : "Memory sources are unavailable for these filters."}
                    </p>
                  ) : null}
                  {items.length ? (
                    <ul className="flex min-w-0 flex-col divide-y divide-border/40">
                      {items.map((record) => (
                        <MemoryRow key={record.id} record={record} open={openRecord} />
                      ))}
                    </ul>
                  ) : records.isSuccess && pageAvailability === "available" ? (
                    <Empty>
                      <EmptyHeader>
                        <EmptyTitle>No matching memory</EmptyTitle>
                        <EmptyDescription>Try another use, status, or search.</EmptyDescription>
                      </EmptyHeader>
                    </Empty>
                  ) : null}
                  {records.hasNextPage ? (
                    <Button
                      variant="secondary"
                      className="w-fit"
                      disabled={records.isFetchingNextPage}
                      onClick={() => void records.fetchNextPage()}
                    >
                      Load more memories
                    </Button>
                  ) : null}
                </TabsContent>
              </Tabs>
            </div>
          </SettingsSection>
          <PreferenceSelection actions={actions} onChanged={refresh} />
          <LearningSettings
            queryKey={queryKey}
            epoch={listEpoch}
            actions={actions}
            onChanged={refresh}
          />
          {adding ? (
            <NewMemory
              purpose={filters.purpose}
              actions={actions}
              close={close}
              restoreFocus={focusInvoker}
              onSaved={refresh}
            />
          ) : null}
          {selection ? (
            <MemoryRecordDetail
              key={selection}
              selection={{ id: selection, purpose: filters.purpose }}
              queryKey={queryKey}
              actions={actions}
              close={close}
              restoreFocus={focusInvoker}
              openRecord={openRecord}
              onChanged={refresh}
              onForget={onForget}
            />
          ) : null}
          {confirmation}
        </>
      ) : null}
    </div>
  );
}

function MemoryFilter({
  id,
  label,
  value,
  options,
  all,
  optionLabel = memoryLabel,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  options: readonly string[];
  all?: string;
  optionLabel?: (value: string) => string;
  onChange: (value: string) => void;
}) {
  return (
    <Field className="min-w-0">
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <NativeSelect
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full"
      >
        {all ? <NativeSelectOption value="">{all}</NativeSelectOption> : null}
        {options.map((item) => (
          <NativeSelectOption key={item} value={item}>
            {optionLabel(item)}
          </NativeSelectOption>
        ))}
      </NativeSelect>
    </Field>
  );
}

function MemoryRow({
  record,
  open,
}: {
  record: KnowledgeRecord;
  open: (id: string, trigger: HTMLElement) => void;
}) {
  const { title, text } = memorySummary(memoryContent(record));
  return (
    <li className="min-w-0">
      <Button
        variant="ghost"
        onClick={(event) => open(record.id, event.currentTarget)}
        className="h-auto w-full min-w-0 justify-between gap-3 rounded-lg px-2 py-3 text-left whitespace-normal"
      >
        <span className="flex min-w-0 flex-col gap-1 [overflow-wrap:anywhere]">
          <span>{title}</span>
          <span className="line-clamp-2 font-normal text-muted-foreground">{text}</span>
          <MemoryBadges record={record} />
          {record.acceptance?.kind === "evidence_rule" ? (
            <span className="text-xs text-muted-foreground">{memoryAcceptance(record)}</span>
          ) : null}
        </span>
        <ChevronRightIcon aria-hidden="true" />
      </Button>
    </li>
  );
}
