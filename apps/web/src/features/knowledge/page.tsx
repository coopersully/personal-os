import type { KnowledgePage, KnowledgeQuery, KnowledgeRecord } from "@personal-os/domain";
import {
  knowledgeContentSchema,
  knowledgeOriginSchema,
  knowledgeQuerySchema,
  knowledgeWorkspaceSchema,
} from "@personal-os/domain";
import { CancelledError, useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useId, useLayoutEffect, useRef, useState } from "react";
import { api } from "@/api";
import { QueryFeedback } from "@/components/async-state";
import { useConfirmAction } from "@/components/confirm-action";
import { ChevronRightIcon, DownloadIcon, PlusIcon, TagsIcon } from "@/components/icons";
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
import { MemoryBadges, MemoryTags } from "./badges";
import {
  type MemoryOpenMode,
  memoryContent,
  memoryFreshness,
  memoryLabel,
  memorySummary,
} from "./presentation";
import { MemoryRecordDetail, NewMemory } from "./record-detail";
import { ManageTags, TagChips, useMemoryTags } from "./tags";
import { restoreMemory, TrashRow } from "./trash";

type View = "all" | "conflicts" | "archived" | "trash";
type Filters = Pick<KnowledgeQuery, "workspace" | "kind" | "origin" | "text">;
/** `opened` remounts the detail on every open, so a mode or draft always starts fresh. */
type Selection = {
  id: string;
  mode?: MemoryOpenMode | undefined;
  content?: KnowledgeRecord["content"] | undefined;
  opened: number;
};

/** The search for one list: tabs pick a view, the rest narrows it. Unset filters are left out. */
function listScope(view: View, filters: Filters, tags: string[]): KnowledgeQuery {
  const scope: KnowledgeQuery = Object.fromEntries(
    Object.entries(filters).filter(([, value]) => value !== undefined),
  );
  if (tags.length) scope.tags = tags;
  if (view === "conflicts") scope.hasConflict = true;
  if (view === "archived") scope.status = "archived";
  if (view === "trash") scope.status = "trashed";
  return scope;
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
  const viewId = useId();
  const [view, setView] = useState<View>("all");
  const [searchText, setSearchText] = useState("");
  const [filters, setFilters] = useState<Filters>({});
  const [tags, setTags] = useState<string[]>([]);
  const [filterVersion, setFilterVersion] = useState(0);
  const [generation, setGeneration] = useState(0);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [adding, setAdding] = useState(false);
  const [managingTags, setManagingTags] = useState(false);
  const [exportPosition, setExportPosition] = useState<{ cursor?: string; page: number }>({
    page: 1,
  });
  const origin = useRef<HTMLElement | null>(null);
  const addButton = useRef<HTMLButtonElement>(null);
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
    setManagingTags(false);
    setSearchText("");
    setFilters((previous) => ({ ...previous, text: undefined }));
    setExportPosition({ page: 1 });
  }, [cache, ownerId, session.epoch]);

  // A continuation conflict can mean previously disclosed records were withdrawn.
  const actions = useMemoryActions(session, {
    canPublish: () => true,
    onRevalidate: () => {
      seenEpoch.current = undefined;
      clearContent();
      actions.notifyError("This memory page expired or changed. Reloading saved memory.");
    },
  });

  /** Reloads memory after a change; silent, since the action already has its own toast. */
  function refresh() {
    cache.removeQueries({ queryKey });
    setGeneration((value) => value + 1);
    seenEpoch.current = undefined;
    setExportPosition({ page: 1 });
  }

  const query = listScope(view, filters, tags);
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
    retry: false,
  });
  const tagIndex = useMemoryTags(queryKey, actions);

  const close = () => {
    setSelection(null);
    setAdding(false);
    setManagingTags(false);
  };
  function focusInvoker() {
    if (!actions.isCurrent()) return;
    const target = origin.current?.isConnected ? origin.current : addButton.current;
    target?.focus();
  }
  function openRecord(
    id: string,
    options: {
      trigger?: HTMLElement;
      mode?: MemoryOpenMode | undefined;
      content?: KnowledgeRecord["content"] | undefined;
    } = {},
  ) {
    if (options.trigger) origin.current = options.trigger;
    setSelection((previous) => ({
      id,
      mode: options.mode,
      content: options.content,
      opened: (previous?.opened ?? 0) + 1,
    }));
  }
  function changeFilters(patch: Partial<Filters>) {
    setFilters((previous) => ({ ...previous, ...patch }));
    setFilterVersion((version) => version + 1);
  }
  function changeTags(next: string[]) {
    setTags(next);
    setFilterVersion((version) => version + 1);
  }
  function restore(record: KnowledgeRecord) {
    void restoreMemory(actions, record, { done: refresh, refused: refresh });
  }

  const { confirm, confirmation } = useConfirmAction();
  function download() {
    confirm({
      intent: "default",
      title: "Download memory?",
      description:
        "This saves a JSON file containing up to 50 available memory revisions on this device. Copies you download stay on this device when you delete memory in nohmi.",
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
            if (!page.items.length) {
              setExportPosition({ page: 1 });
              return { message: "No available memory to download.", tone: "info" };
            }
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
      <SettingsSection title="Saved memory">
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
            <Button
              variant="secondary"
              disabled={actions.busy}
              onClick={(event) => {
                origin.current = event.currentTarget;
                setManagingTags(true);
              }}
            >
              <TagsIcon data-icon="inline-start" aria-hidden="true" />
              Manage tags
            </Button>
            <Button variant="secondary" disabled={actions.busy} onClick={download}>
              <DownloadIcon data-icon="inline-start" aria-hidden="true" />
              {exportPosition.cursor ? "Download next page" : "Download memory"}
            </Button>
          </div>
          <Tabs
            value={view}
            onValueChange={(value) => {
              setView(value as View);
              setFilterVersion((version) => version + 1);
            }}
          >
            <TabsList
              aria-label="Memory views"
              className="max-w-full flex-wrap justify-start group-data-horizontal/tabs:h-auto [&>[role=tab]]:h-auto"
            >
              <TabsTrigger value="all">All</TabsTrigger>
              <TabsTrigger value="conflicts">Conflicts</TabsTrigger>
              <TabsTrigger value="archived">Archived</TabsTrigger>
              <TabsTrigger value="trash">Trash</TabsTrigger>
            </TabsList>
            <TabsContent value={view} className="flex min-w-0 flex-col gap-3">
              <form
                className="flex flex-wrap items-end gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  const text = searchText.trim();
                  const parsed = knowledgeQuerySchema.safeParse({ text: text || undefined });
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
              <TagChips index={tagIndex.data} selected={tags} change={changeTags} />
              <FieldGroup className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,8rem),1fr))] gap-2">
                <MemoryFilter
                  id={`${viewId}-kind`}
                  label="Type"
                  value={filters.kind ?? ""}
                  options={knowledgeContentSchema.options.map((option) => option.shape.kind.value)}
                  all="All types"
                  onChange={(kind) =>
                    changeFilters({ kind: (kind || undefined) as Filters["kind"] })
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
                  id={`${viewId}-origin`}
                  label="Origin"
                  value={filters.origin ?? ""}
                  options={knowledgeOriginSchema.options}
                  all="Stated and inferred"
                  onChange={(value) =>
                    changeFilters({ origin: (value || undefined) as Filters["origin"] })
                  }
                />
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
                  {items.map((record) =>
                    view === "trash" ? (
                      <TrashRow
                        key={record.id}
                        record={record}
                        busy={actions.busy}
                        open={(trigger) => openRecord(record.id, { trigger })}
                        restore={() => restore(record)}
                        deleteNow={(trigger) => openRecord(record.id, { trigger, mode: "delete" })}
                      />
                    ) : (
                      <MemoryRow
                        key={record.id}
                        record={record}
                        open={(trigger) => openRecord(record.id, { trigger })}
                      />
                    ),
                  )}
                </ul>
              ) : records.isSuccess && pageAvailability === "available" ? (
                <Empty>
                  <EmptyHeader>
                    <EmptyTitle>No matching memory</EmptyTitle>
                    <EmptyDescription>
                      {view === "trash"
                        ? "Trashed memory appears here for 30 days."
                        : "Try another tag, filter, or search."}
                    </EmptyDescription>
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
      {adding ? (
        <NewMemory actions={actions} close={close} restoreFocus={focusInvoker} onSaved={refresh} />
      ) : null}
      {managingTags ? (
        <ManageTags
          tags={tagIndex}
          actions={actions}
          close={close}
          restoreFocus={focusInvoker}
          onChanged={refresh}
        />
      ) : null}
      {selection ? (
        <MemoryRecordDetail
          key={selection.opened}
          selection={selection}
          queryKey={queryKey}
          actions={actions}
          close={close}
          restoreFocus={focusInvoker}
          openRecord={(id, mode, content) => openRecord(id, { mode, content })}
          onChanged={refresh}
        />
      ) : null}
      {confirmation}
    </div>
  );
}

function MemoryFilter({
  id,
  label,
  value,
  options,
  all,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  options: readonly string[];
  all: string;
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
        <NativeSelectOption value="">{all}</NativeSelectOption>
        {options.map((item) => (
          <NativeSelectOption key={item} value={item}>
            {memoryLabel(item)}
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
  open: (trigger: HTMLElement) => void;
}) {
  const { title, text } = memorySummary(memoryContent(record));
  return (
    <li className="min-w-0">
      <Button
        variant="ghost"
        onClick={(event) => open(event.currentTarget)}
        className="h-auto w-full min-w-0 justify-between gap-3 rounded-lg px-2 py-3 text-left whitespace-normal"
      >
        <span className="flex min-w-0 flex-col gap-1 [overflow-wrap:anywhere]">
          <span>{title}</span>
          <span className="line-clamp-2 font-normal text-muted-foreground">{text}</span>
          <MemoryBadges record={record} />
          <MemoryTags tags={record.tags} />
          <span className="text-sm font-normal text-muted-foreground">
            {memoryFreshness(record)}
          </span>
        </span>
        <ChevronRightIcon aria-hidden="true" />
      </Button>
    </li>
  );
}
