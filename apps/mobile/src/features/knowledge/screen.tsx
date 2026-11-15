import {
  type KnowledgeQuery,
  type KnowledgeRecord,
  knowledgePurposeSchema,
  knowledgeWorkspaceSchema,
} from "@personal-os/domain";
import { router, Stack, useFocusEffect, usePreventRemove } from "expo-router";
import { useCallback, useMemo, useRef, useState } from "react";
import { Keyboard, View } from "react-native";
import { toast } from "sonner-native";
import { editorDismissOptions } from "../../components/editor-header";
import { FloatingAdd } from "../../components/forms/form-save";
import { Icon } from "../../components/icons";
import { RecordRow } from "../../components/record-row";
import { SettingsAccentProvider } from "../../components/settings-accent";
import { useTheme } from "../../theme";
import { useAuth } from "../auth/context";
import { confirmDiscard, Field, Section } from "../goals/controls";
import { SettingsActionRow } from "../settings/settings-row";
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
import { MemoryBody, MemoryChoice, MemoryReadState, MemoryText } from "./controls";
import { MemoryDetail, type Selection } from "./detail";
import { MemoryEditor } from "./editor";
import {
  memoryContent,
  memoryKinds,
  memoryLabel,
  memoryState,
  memorySummary,
} from "./presentation";
import { memoryShareAvailable, shareMemoryPage } from "./share";

type Destination = { kind: "list" } | { kind: "detail"; selection: Selection };
const listDestination: Destination = { kind: "list" };

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
      {...{ api, access }}
      initial={destination}
      revalidate={revalidate}
      retain={finish}
    />
  );
}

type PrivateProps = {
  api: MemoryApi;
  access: MemoryAccess;
  initial: Destination;
  revalidate: (next?: Destination) => void;
  retain: (id: string, feedback: Feedback) => void;
};
function PrivateMemory({ api, access, initial, revalidate, retain }: PrivateProps) {
  const [destination, setDestination] = useState<Destination | { kind: "add" }>(initial);
  const [purpose, setPurpose] = useState<KnowledgeQuery["purpose"]>(
    initial.kind === "detail" ? initial.selection.purpose : "planning",
  );
  const [dirty, setDirty] = useState(false);
  const commands = useMemoryCommands(access.capture, access.recover);
  const mutationKey = useMutationKey();
  const close = () => {
    setDirty(false);
    setDestination(listDestination);
  };
  usePreventRemove(destination.kind === "add" && dirty && !commands.busy, ({ repeat }) => {
    confirmDiscard(() => {
      setDirty(false);
      repeat();
    });
  });
  function closeAdd() {
    if (commands.busy) revalidate();
    else if (dirty) confirmDiscard(close);
    else close();
  }
  const open = (id: string) => setDestination({ kind: "detail", selection: { id, purpose } });

  if (destination.kind === "detail") {
    return (
      <>
        <Stack.Screen options={{ title: "Memory details" }} />
        <MemoryDetail
          key={destination.selection.id}
          {...{ api, access, open, retain }}
          selection={destination.selection}
          close={close}
          changed={(selection) =>
            revalidate(selection ? { kind: "detail", selection } : listDestination)
          }
        />
      </>
    );
  }
  if (destination.kind === "add") {
    return (
      <>
        <Stack.Screen
          options={{
            title: "Add Memory",
            ...editorDismissOptions({ label: dirty ? "Cancel" : "Close", onPress: closeAdd }),
          }}
        />
        <MemoryEditor
          mode="add"
          purpose={purpose}
          disabled={commands.busy}
          onDirty={() => setDirty(true)}
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
                  value.outcome === "readable" && value.record.purposes.includes(purpose)
                    ? { kind: "detail", selection: { id: value.record.id, purpose } }
                    : listDestination,
                );
                return {
                  message:
                    value.outcome === "pending_owner_review"
                      ? "Memory saved for review."
                      : value.outcome === "readable"
                        ? "Memory saved."
                        : "This memory is unavailable.",
                };
              },
              retain,
            });
          }}
          layout={(fields, save) => <MemoryBody save={save}>{fields}</MemoryBody>}
        />
      </>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: "Memory", headerLeft: undefined }} />
      <MemoryList
        {...{ api, access, open, purpose }}
        setPurpose={setPurpose}
        onAdd={() => setDestination({ kind: "add" })}
      />
    </>
  );
}

const views = ["accepted", "review", "conflicts", "all"] as const;
type ViewMode = (typeof views)[number];
type Status = NonNullable<KnowledgeQuery["status"]> | "stale";
const reviewStatuses: Status[] = ["proposed", "disputed", "stale"];
const allStatuses: Status[] = ["active", ...reviewStatuses, "expired", "superseded"];
const statusLabels = { active: "Accepted", stale: "Review due", "": "Any status" };
const viewLabels = {
  accepted: "Accepted",
  review: "Needs review",
  conflicts: "Conflicts",
  all: "All memory",
};
type ListProps = {
  api: MemoryApi;
  access: MemoryAccess;
  purpose: KnowledgeQuery["purpose"];
  setPurpose: (purpose: KnowledgeQuery["purpose"]) => void;
  open: (id: string) => void;
  onAdd: () => void;
};
function MemoryList({ api, access, purpose, setPurpose, open, onAdd }: ListProps) {
  const [view, setView] = useState<ViewMode>("accepted");
  const [status, setStatus] = useState<Status | "">("");
  const [workspace, setWorkspace] = useState<KnowledgeQuery["workspace"]>();
  const [kind, setKind] = useState<KnowledgeQuery["kind"]>();
  const [draft, setDraft] = useState("");
  const [text, setText] = useState("");
  const [filters, setFilters] = useState(false);
  const [exportPosition, setExportPosition] = useState<{ cursor?: string; page: number }>({
    page: 1,
  });
  const statuses =
    view === "review"
      ? reviewStatuses
      : view === "conflicts"
        ? allStatuses.slice(0, 4)
        : allStatuses;
  const query = useMemo<KnowledgeQuery>(
    () => ({
      purpose,
      workspace,
      kind,
      text: text || undefined,
      ...(status && status !== "stale" ? { status } : {}),
      ...(view === "conflicts" ? { hasConflict: true } : {}),
      ...(view === "accepted"
        ? { reviewView: "accepted" }
        : status === "stale"
          ? { reviewView: "review_due" }
          : view === "review"
            ? { reviewView: "needs_review" }
            : {}),
    }),
    [purpose, workspace, kind, text, status, view],
  );
  const load = useCallback(
    (signal: AbortSignal) =>
      readMemory(access, signal, () => api.searchKnowledge(query), {
        epoch: (result) => result.epoch,
      }),
    [access, api, query],
  );
  const commands = useMemoryCommands(access.capture, access.recover);
  const current = access.capture();

  function share() {
    const { cursor, page } = exportPosition;
    void commands.run({
      loading: "Preparing memory export…",
      failure: "Couldn’t share memory. Try again.",
      cursor: Boolean(cursor),
      request: async (canPublish) => {
        if (!memoryShareAvailable()) throw new Error("unsupported");
        const result = await api.exportKnowledge({ cursor });
        if (!canPublish()) return;
        if (!access.observe(result)) return;
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
          message: "Memory export shared.",
          ...(result.state === "partial" && {
            description: "The file includes available revisions.",
          }),
        };
      },
      rejected: (error) =>
        error instanceof Error && error.message === "unsupported"
          ? "Memory export is unavailable on this device."
          : undefined,
    });
  }

  return (
    <MemoryListResults
      key={JSON.stringify(query)}
      {...{ api, access, query, load, open }}
      disabled={commands.busy}
      add={<FloatingAdd label="Add memory" onPress={onAdd} disabled={commands.busy} />}
      header={(pending) => (
        <>
          <Section title="Saved Memory">
            <MemoryChoice
              label="View"
              value={view}
              choices={views}
              labels={viewLabels}
              disabled={pending}
              onChange={(value) => {
                setView(value);
                setStatus("");
              }}
            />
            <Field
              label="Search memory"
              value={draft}
              onChange={(value) => setDraft(value.slice(0, 500))}
              disabled={pending}
            />
            <SettingsActionRow
              label="Search"
              disabled={pending || draft.trim() === text}
              onPress={() => {
                Keyboard.dismiss();
                setText(draft.trim());
              }}
            />
            {text && (
              <SettingsActionRow
                label="Clear search"
                disabled={pending}
                onPress={() => {
                  setText("");
                  setDraft("");
                }}
              />
            )}
            <SettingsActionRow
              label={filters ? "Hide filters" : "Filters"}
              disabled={pending}
              onPress={() => setFilters(!filters)}
            />
          </Section>
          {filters && (
            <Section title="Filters">
              <MemoryChoice
                label="Use"
                value={purpose}
                choices={knowledgePurposeSchema.options}
                onChange={setPurpose}
                disabled={pending}
              />
              <MemoryChoice
                label="Workspace"
                value={workspace ?? ""}
                choices={["", ...knowledgeWorkspaceSchema.options]}
                labels={{ "": "All workspaces" }}
                onChange={(value) => setWorkspace(value || undefined)}
                disabled={pending}
              />
              <MemoryChoice
                label="Type"
                value={kind ?? ""}
                choices={["", ...memoryKinds]}
                labels={{ "": "All types" }}
                onChange={(value) => setKind(value || undefined)}
                disabled={pending}
              />
              {view !== "accepted" && (
                <MemoryChoice
                  label="Status"
                  value={status}
                  choices={["", ...statuses]}
                  labels={statusLabels}
                  onChange={setStatus}
                  disabled={pending}
                />
              )}
            </Section>
          )}
        </>
      )}
      footer={(pending) => (
        <Section title="Memory settings">
          <SettingsActionRow
            label={exportPosition.cursor ? "Share next export page" : "Share memory export"}
            onPress={share}
            disabled={pending}
          />
          {!memoryShareAvailable() && (
            <View style={{ paddingHorizontal: 16, paddingBottom: 12 }}>
              <MemoryText>File sharing is unavailable on this device.</MemoryText>
            </View>
          )}
          <SettingsActionRow
            label="Close memory"
            onPress={() => {
              if (current()) router.back();
            }}
          />
        </Section>
      )}
    />
  );
}

function MemoryListResults({
  api,
  access,
  query,
  load,
  open,
  header,
  footer,
  add,
  disabled,
}: Pick<ListProps, "api" | "access" | "open"> & {
  query: KnowledgeQuery;
  load: (
    signal: AbortSignal,
  ) => ReturnType<typeof readMemory<Awaited<ReturnType<MemoryApi["searchKnowledge"]>>>>;
  header: (disabled: boolean) => React.ReactNode;
  footer: (disabled: boolean) => React.ReactNode;
  add: React.ReactNode;
  disabled: boolean;
}) {
  const list = useMemoryResource(load);
  const [more, setMore] = useState<Awaited<ReturnType<MemoryApi["searchKnowledge"]>>[]>([]);
  const commands = useMemoryCommands(access.capture, access.recover);
  const initial = list.value;
  const cursor = (more.at(-1) ?? initial)?.nextCursor;
  const pending = commands.busy || disabled;

  async function refresh() {
    if (pending) return;
    setMore([]);
    await list.reload();
  }

  const records = initial ? [initial, ...more].flatMap((result) => result.items) : [];
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
              ? "Memory is unavailable for this use."
              : "No matching memory"}
          </MemoryText>
        ))}
      {cursor && (
        <SettingsActionRow
          label="Load more memory"
          disabled={pending}
          onPress={() =>
            void commands.run({
              loading: "Loading more memory…",
              failure: "Couldn’t load more memory.",
              cursor: true,
              request: () => api.searchKnowledge({ ...query, cursor }),
              complete: (result) => {
                access.observe(result);
                setMore((previous) => [...previous, result]);
                return { message: "More memory loaded.", tone: "info" };
              },
            })
          }
        />
      )}
      {footer(pending)}
    </MemoryBody>
  );
}

function MemoryRow({ record, open }: { record: KnowledgeRecord; open: () => void }) {
  const summary = memorySummary(memoryContent(record));
  const t = useTheme();
  return (
    <RecordRow
      title={summary.title}
      leading={<Icon name="history" size={20} color={t.secondary} />}
      subtitle={`${summary.text}\n${memoryLabel(record.origin)} · ${memoryState(record)}`}
      onPress={open}
    />
  );
}
