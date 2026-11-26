import {
  type KnowledgeQuery,
  type KnowledgeRecord,
  knowledgeOriginSchema,
  knowledgeTagsMax,
  knowledgeWorkspaceSchema,
} from "@personal-os/domain";
import { Stack, useFocusEffect, usePreventRemove } from "expo-router";
import { type ReactNode, useCallback, useMemo, useRef, useState } from "react";
import { Keyboard, ScrollView, View } from "react-native";
import { toast } from "sonner-native";
import { editorDismissOptions } from "../../components/editor-header";
import { FilterChip } from "../../components/filter-chip";
import { FloatingAdd } from "../../components/forms/form-save";
import { Icon } from "../../components/icons";
import { RecordRow } from "../../components/record-row";
import { SettingsAccentProvider, useSettingsAccent } from "../../components/settings-accent";
import { useTheme } from "../../theme";
import { useAuth } from "../auth/context";
import { confirmDiscard, Field, Section } from "../goals/controls";
import { SettingsActionRow } from "../settings/settings-row";
import { SettingsViewSwitcher } from "../settings/view-switcher";
import {
  type Feedback,
  type MemoryAccess,
  type MemoryApi,
  readMemory,
  statusOf,
  useMemoryCommands,
  useMemoryResource,
  useMutationKey,
  useVisitAuthority,
} from "./authority";
import { MemoryBody, MemoryChoice, MemoryReadState, MemoryText, plainHeader } from "./controls";
import { type BackHandler, MemoryDetail } from "./detail";
import { MemoryEditor } from "./editor";
import {
  memoryContent,
  memoryFreshness,
  memoryKinds,
  memoryLabels,
  memoryStatus,
  memorySummary,
  originLabels,
} from "./presentation";
import { memoryShareAvailable, shareMemoryPage } from "./share";
import { MemoryTags } from "./tags";

type Destination =
  | { kind: "list" }
  | { kind: "detail"; id: string; edit?: KnowledgeRecord["content"] }
  | { kind: "add" }
  | { kind: "tags" };
const listDestination: Destination = { kind: "list" };

const views = ["all", "conflicts", "archived", "trash"] as const;
type ViewMode = (typeof views)[number];
const viewOptions = [
  { value: "all", label: "All" },
  { value: "conflicts", label: "Conflicts" },
  { value: "archived", label: "Archived", icon: "archive" },
  { value: "trash", label: "Trash", icon: "trash" },
] as const;
/** What the list shows. It lives with the visit, so opening a memory and going back keeps it. */
export type ListState = {
  view: ViewMode;
  draft: string;
  text: string;
  tags: string[];
  kind?: KnowledgeQuery["kind"];
  workspace?: KnowledgeQuery["workspace"];
  origin?: KnowledgeQuery["origin"];
  filters: boolean;
};
const initialList: ListState = { view: "all", draft: "", text: "", tags: [], filters: false };

/** At most `limit` UTF-16 units, never ending inside a character (half an emoji is invalid). */
function clipText(text: string, limit: number) {
  if (text.length <= limit) return text;
  const clipped = text.slice(0, limit);
  const last = clipped.charCodeAt(limit - 1);
  return last >= 0xd800 && last <= 0xdbff ? clipped.slice(0, -1) : clipped;
}

function listQuery({ view, text, tags, kind, workspace, origin }: ListState): KnowledgeQuery {
  return {
    ...(text ? { text } : {}),
    ...(tags.length ? { tags } : {}),
    ...(kind ? { kind } : {}),
    ...(workspace ? { workspace } : {}),
    ...(origin ? { origin } : {}),
    ...(view === "conflicts"
      ? { hasConflict: true }
      : view === "archived"
        ? { status: "archived" }
        : view === "trash"
          ? { status: "trashed" }
          : {}),
  };
}

export function MemoryScreen() {
  const { state, session } = useAuth();
  const [focused, setFocused] = useState(false);
  const focusedRef = useRef(false);
  useFocusEffect(
    useCallback(() => {
      focusedRef.current = true;
      setFocused(true);
      return () => {
        focusedRef.current = false;
        setFocused(false);
      };
    }, []),
  );
  const epoch = session.epoch();
  const signedIn = useCallback(
    () => focusedRef.current && session.epoch() === epoch,
    [session, epoch],
  );
  // Everything read here lives in this visit; signing out unmounts it, so nothing outlives the
  // owner, and there is no offline copy or write queue to clear.
  if (!focused || state.status !== "signedIn") return null;
  return (
    <SettingsAccentProvider>
      <MemoryVisit key={`${state.user.id}:${epoch}`} apiFactory={session.api} signedIn={signedIn} />
    </SettingsAccentProvider>
  );
}

function MemoryVisit({
  apiFactory,
  signedIn,
}: {
  apiFactory: () => MemoryApi;
  signedIn: () => boolean;
}) {
  const [api] = useState(apiFactory);
  const visit = useVisitAuthority(signedIn);
  const [generation, setGeneration] = useState(0);
  const [destination, setDestination] = useState<Destination>(listDestination);
  const [list, setList] = useState(initialList);
  const seenEpoch = useRef<number>(undefined);
  const operations = useMemoryCommands(visit.capture);
  const invalidate = visit.invalidate;
  const { finish } = operations;

  const revalidate = useCallback(
    (next: Destination = listDestination) => {
      invalidate();
      seenEpoch.current = undefined;
      setDestination(next);
      setGeneration((value) => value + 1);
    },
    [invalidate],
  );

  const access = useMemo<MemoryAccess>(
    () => ({
      capture: visit.capture,
      recover(error, cursor) {
        if (!(cursor && statusOf(error) === 409)) return false;
        revalidate();
        toast.error("This memory page changed. Reloading saved memory.");
        return true;
      },
      observe({ epoch }) {
        if (seenEpoch.current !== undefined && seenEpoch.current !== epoch) {
          revalidate();
          return false;
        }
        seenEpoch.current = epoch;
        return true;
      },
    }),
    [visit.capture, revalidate],
  );

  return (
    <PrivateMemory
      key={generation}
      {...{ api, access, list, setList, revalidate }}
      initial={destination}
      retain={finish}
    />
  );
}

type PrivateProps = {
  api: MemoryApi;
  access: MemoryAccess;
  initial: Destination;
  list: ListState;
  setList: (update: (list: ListState) => ListState) => void;
  revalidate: (next?: Destination) => void;
  retain: (id: string, feedback: Feedback) => void;
};
function PrivateMemory({ api, access, initial, list, setList, revalidate, retain }: PrivateProps) {
  const [destination, setDestination] = useState<Destination>(initial);
  const [dirty, setDirty] = useState(false);
  const commands = useMemoryCommands(access.capture, access.recover);
  const back: BackHandler = useRef(undefined);
  const close = () => {
    setDirty(false);
    setDestination(listDestination);
  };
  function closeAdd() {
    // Leaving during a save fences it: its result no longer reaches this screen.
    if (commands.busy) revalidate();
    else if (dirty) confirmDiscard(close);
    else close();
  }
  // Native back leaves an open memory, the editor or tags for the list, not the Memory screen.
  usePreventRemove(destination.kind !== "list", () => {
    if (destination.kind === "add") closeAdd();
    else if (destination.kind === "detail") (back.current ?? close)();
    else close();
  });
  const open = (id: string) => setDestination({ kind: "detail", id });

  if (destination.kind === "detail") {
    return (
      <MemoryDetail
        key={destination.id}
        {...{ api, access, open, retain, close, back }}
        id={destination.id}
        edit={destination.edit}
        changed={(id, edit) => revalidate(id ? { kind: "detail", id, edit } : listDestination)}
      />
    );
  }
  if (destination.kind === "tags") {
    return (
      <>
        <Stack.Screen options={{ title: "Tags", ...plainHeader }} />
        <MemoryTags {...{ api, access, retain }} changed={() => revalidate({ kind: "tags" })} />
      </>
    );
  }
  if (destination.kind === "add") {
    return (
      <>
        <Stack.Screen
          options={{
            title: "Add memory",
            ...plainHeader,
            ...editorDismissOptions({ label: dirty ? "Cancel" : "Close", onPress: closeAdd }),
          }}
        />
        <AddMemory {...{ api, commands, revalidate, retain }} onDirty={() => setDirty(true)} />
      </>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: "Memory", ...plainHeader }} />
      <MemoryList
        {...{ api, access, open, list, setList }}
        onAdd={() => setDestination({ kind: "add" })}
        onTags={() => setDestination({ kind: "tags" })}
      />
    </>
  );
}

/** One Add session. It owns the mutation keys, so leaving the editor starts the next one fresh. */
function AddMemory({
  api,
  commands,
  revalidate,
  retain,
  onDirty,
}: Pick<PrivateProps, "api" | "revalidate" | "retain"> & {
  commands: ReturnType<typeof useMemoryCommands>;
  onDirty: () => void;
}) {
  const mutationKey = useMutationKey();
  return (
    <MemoryEditor
      mode="add"
      disabled={commands.busy}
      onDirty={onDirty}
      onInvalid={() => toast.error("Check the memory fields and try again.")}
      onSave={(input) => {
        if ("action" in input) return;
        const { mutationKey: _key, ...body } = input;
        void commands.run({
          loading: "Saving memory…",
          failure: "Couldn’t confirm this memory was saved. You can retry the same entry.",
          request: () => api.saveKnowledge({ ...input, mutationKey: mutationKey(body) }),
          complete: (value) => {
            revalidate(
              value.outcome === "readable"
                ? { kind: "detail", id: value.record.id }
                : listDestination,
            );
            return {
              message:
                value.outcome === "readable" ? "Memory saved." : "This memory is unavailable.",
            };
          },
          retain,
        });
      }}
      layout={(fields, save) => <MemoryBody save={save}>{fields}</MemoryBody>}
    />
  );
}

type ListProps = {
  api: MemoryApi;
  access: MemoryAccess;
  list: ListState;
  setList: PrivateProps["setList"];
  open: (id: string) => void;
  onAdd: () => void;
  onTags: () => void;
};
type SearchPage = Awaited<ReturnType<MemoryApi["searchKnowledge"]>>;

function MemoryList({ api, access, list, setList, open, onAdd, onTags }: ListProps) {
  // Typing a search or opening filters changes the list state, not the query: no reload.
  const queryKey = JSON.stringify(listQuery(list));
  const query = useMemo<KnowledgeQuery>(() => JSON.parse(queryKey), [queryKey]);
  const change = (update: Partial<ListState>) => setList((current) => ({ ...current, ...update }));
  const load = useCallback(
    (signal: AbortSignal) =>
      readMemory(access, signal, () => api.searchKnowledge(query), {
        epoch: (result) => result.epoch,
      }),
    [access, api, query],
  );
  const loadTags = useCallback(
    (signal: AbortSignal) => readMemory(access, signal, () => api.listKnowledgeTags()),
    [access, api],
  );
  const tagIndex = useMemoryResource(loadTags);
  const commands = useMemoryCommands(access.capture, access.recover);
  const [exportPosition, setExportPosition] = useState<{ cursor?: string; page: number }>({
    page: 1,
  });
  const accent = useSettingsAccent();

  function share() {
    const { cursor, page } = exportPosition;
    void commands.run({
      loading: "Preparing memory export…",
      failure: "Couldn’t share memory. Try again.",
      cursor: Boolean(cursor),
      request: async (canPublish) => {
        if (!memoryShareAvailable()) throw new Error("unsupported");
        const result = await api.exportKnowledge({ cursor });
        if (!canPublish() || !access.observe(result)) return;
        if (result.state === "unavailable") return { result, shared: false };
        const shared = await shareMemoryPage(result, page, canPublish);
        return { result, shared };
      },
      complete: (exported) => {
        if (!exported) return;
        const { result, shared } = exported;
        if (result.state === "unavailable")
          return { message: "Memory export is unavailable.", tone: "error" };
        if (!shared) return;
        setExportPosition(
          result.nextCursor ? { cursor: result.nextCursor, page: page + 1 } : { page: 1 },
        );
        return {
          message: result.nextCursor
            ? `Shared export page ${page}. Share the next page to continue.`
            : "Memory export shared.",
          ...(result.state === "partial" && {
            description: "The file includes available revisions.",
          }),
        };
      },
      rejected: (error) =>
        error instanceof Error && error.message === "unsupported"
          ? "Sharing files isn’t available on this device."
          : undefined,
    });
  }

  const tags = tagIndex.value?.tags ?? [];
  // Selected tags stay visible even when the index no longer lists them.
  const chips = [...new Set([...list.tags, ...tags.map((tag) => tag.name)])];
  return (
    <MemoryListResults
      key={queryKey}
      {...{ api, access, query, load, open }}
      view={list.view}
      filtered={Object.keys(query).some((key) => key !== "status" && key !== "hasConflict")}
      refreshTags={tagIndex.refresh}
      disabled={commands.busy}
      add={
        list.view === "trash" ? null : (
          <FloatingAdd label="Add memory" onPress={onAdd} disabled={commands.busy} />
        )
      }
      header={(pending) => (
        <>
          <SettingsViewSwitcher
            value={list.view}
            options={viewOptions}
            onChange={(value) => {
              const view = views.find((entry) => entry === value);
              if (view && !pending) change({ view });
            }}
          />
          <Section>
            <Field
              label="Search memory"
              value={list.draft}
              onChange={(value) => change({ draft: clipText(value, 500) })}
              disabled={pending}
            />
            <SettingsActionRow
              label="Search"
              icon="search"
              disabled={pending || list.draft.trim() === list.text}
              onPress={() => {
                Keyboard.dismiss();
                change({ text: list.draft.trim() });
              }}
            />
            {list.text && (
              <SettingsActionRow
                label="Clear search"
                disabled={pending}
                onPress={() => change({ text: "", draft: "" })}
              />
            )}
            <SettingsActionRow
              label={list.filters ? "Hide filters" : "Filters"}
              disabled={pending}
              onPress={() => change({ filters: !list.filters })}
            />
          </Section>
          {chips.length > 0 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={{ flexDirection: "row", gap: 8 }}>
                {chips.map((tag) => {
                  const selected = list.tags.includes(tag);
                  return (
                    <FilterChip
                      key={tag}
                      label={`#${tag}`}
                      icon="categoryTags"
                      selected={selected}
                      color={accent}
                      // A search takes at most 8 tags; unselected chips wait until one is freed.
                      disabled={!selected && list.tags.length >= knowledgeTagsMax}
                      onPress={() => {
                        if (pending) return;
                        change({
                          tags: selected
                            ? list.tags.filter((entry) => entry !== tag)
                            : [...list.tags, tag],
                        });
                      }}
                    />
                  );
                })}
              </View>
            </ScrollView>
          )}
          {list.filters && (
            <Section title="Filters">
              <MemoryChoice
                label="Type"
                value={list.kind ?? ""}
                choices={["", ...memoryKinds]}
                labels={{ "": "All types" }}
                onChange={(kind) => change({ kind: kind || undefined })}
                disabled={pending}
              />
              <MemoryChoice
                label="Workspace"
                value={list.workspace ?? ""}
                choices={["", ...knowledgeWorkspaceSchema.options]}
                labels={{ "": "All workspaces" }}
                onChange={(workspace) => change({ workspace: workspace || undefined })}
                disabled={pending}
              />
              <MemoryChoice
                label="Origin"
                value={list.origin ?? ""}
                choices={["", ...knowledgeOriginSchema.options]}
                labels={{ "": "Stated and inferred", ...originLabels }}
                onChange={(origin) => change({ origin: origin || undefined })}
                disabled={pending}
              />
            </Section>
          )}
        </>
      )}
      footer={(pending) => (
        <Section title="Manage memory">
          <SettingsActionRow
            label="Manage tags"
            icon="categoryTags"
            onPress={onTags}
            disabled={pending}
          />
          <SettingsActionRow
            label={exportPosition.cursor ? "Share next export page" : "Share memory export"}
            icon="send"
            onPress={share}
            disabled={pending}
          />
          {!memoryShareAvailable() && (
            <View style={{ paddingHorizontal: 16, paddingBottom: 12 }}>
              <MemoryText>Sharing files isn’t available on this device.</MemoryText>
            </View>
          )}
        </Section>
      )}
    />
  );
}

const partialText = "Some memories couldn’t be shown right now.";
const emptyText: Record<ViewMode, string> = {
  all: "No memories yet. Agents save what you tell them, and you can add your own.",
  conflicts: "No conflicts. When an agent proposes a change to a memory you hold, it shows here.",
  archived: "No archived memories.",
  trash: "Trash is empty. Memories you move here are deleted for good after 30 days.",
};

function MemoryListResults({
  api,
  access,
  query,
  view,
  filtered,
  load,
  refreshTags,
  open,
  header,
  footer,
  add,
  disabled,
}: Pick<ListProps, "api" | "access" | "open"> & {
  query: KnowledgeQuery;
  view: ViewMode;
  filtered: boolean;
  load: (signal: AbortSignal) => Promise<SearchPage | undefined>;
  refreshTags: () => Promise<unknown>;
  header: (disabled: boolean) => ReactNode;
  footer: (disabled: boolean) => ReactNode;
  add: ReactNode;
  disabled: boolean;
}) {
  const list = useMemoryResource(load);
  const [more, setMore] = useState<SearchPage[]>([]);
  const commands = useMemoryCommands(access.capture, access.recover);
  const initial = list.value;
  const cursor = (more.at(-1) ?? initial)?.nextCursor;
  const pending = commands.busy || disabled;
  // Which first page the extra pages continue. A refresh installs a new one, so a page asked
  // for before it landed continues a list that is gone.
  const sequence = useRef(0);

  /** Pull-to-refresh: the native spinner, and one Sonner error if either read fails. */
  async function refresh() {
    if (pending) return;
    const results = await Promise.allSettled([
      list.refresh().then(() => {
        sequence.current += 1;
        setMore([]);
      }),
      refreshTags(),
    ]);
    const failed = results.find((result) => result.status === "rejected");
    if (failed) throw failed.reason;
  }

  const pages = initial ? [initial, ...more] : [];
  const records = pages.flatMap((result) => result.items);
  return (
    <MemoryBody onRefresh={refresh} save={add}>
      {header(pending)}
      <MemoryReadState
        {...list}
        label="saved memory"
        retry={() => void list.reload().catch(() => toast.error("Couldn’t load saved memory."))}
        busy={pending}
      />
      {initial &&
        (records.length ? (
          <View style={{ gap: 8 }}>
            {records.map((record) => (
              <MemoryRow
                key={record.id}
                record={record}
                open={() => {
                  if (!pending) open(record.id);
                }}
              />
            ))}
          </View>
        ) : (
          <MemoryText>
            {initial.state === "unavailable"
              ? "Memory is unavailable right now."
              : initial.state === "partial"
                ? partialText
                : filtered
                  ? "No memories match."
                  : emptyText[view]}
          </MemoryText>
        ))}
      {records.length > 0 && pages.some((result) => result.state === "partial") && (
        <MemoryText>{partialText}</MemoryText>
      )}
      {cursor && (
        <SettingsActionRow
          label="Load more memory"
          disabled={pending}
          onPress={() => {
            const issued = sequence.current;
            void commands.run({
              loading: "Loading more memory…",
              failure: "Couldn’t load more memory.",
              cursor: true,
              request: () => api.searchKnowledge({ ...query, cursor }),
              complete: (result) => {
                if (issued !== sequence.current || !access.observe(result)) return;
                setMore((previous) => [...previous, result]);
                return { message: "More memory loaded.", tone: "info" };
              },
            });
          }}
        />
      )}
      {footer(pending)}
    </MemoryBody>
  );
}

function MemoryRow({ record, open }: { record: KnowledgeRecord; open: () => void }) {
  const summary = memorySummary(memoryContent(record));
  const t = useTheme();
  const meta = [...memoryLabels(record), memoryStatus(record), memoryFreshness(record)].filter(
    Boolean,
  );
  const tags = record.tags.map((tag) => `#${tag}`).join(" ");
  return (
    <RecordRow
      title={summary.title}
      leading={
        <Icon
          name={record.origin === "inferred" ? "agent" : "profile"}
          size={20}
          color={t.secondary}
        />
      }
      subtitle={[summary.text, tags, meta.join(" · ")].filter(Boolean).join("\n")}
      onPress={open}
    />
  );
}
