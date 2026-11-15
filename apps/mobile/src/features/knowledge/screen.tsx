import {
  type KnowledgeForgetStatus,
  type KnowledgeQuery,
  type KnowledgeRecord,
  knowledgePurposeSchema,
  knowledgeWorkspaceSchema,
} from "@personal-os/domain";
import { router, Stack, useFocusEffect, usePreventRemove } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Keyboard, View } from "react-native";
import { toast } from "sonner-native";
import { Body, Heading } from "../../components/detail-content";
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
  isErasureFence,
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
type ActiveErasure = { operationId: string; status: "pending" | "blocked"; toastId?: string };

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
  const activeGeneration = useRef(0);
  const [available, setAvailable] = useState(false);
  const [destination, setDestination] = useState<Destination>(listDestination);
  const [erasure, setErasure] = useState<ActiveErasure>();
  const allowed = useRef(false);
  const seenEpoch = useRef<number>(undefined);
  const operations = useMemoryCommands(visit.capture);
  const current = visit.current;
  const invalidate = visit.invalidate;
  const operationId = erasure?.operationId;
  const operationToast = erasure?.toastId;
  const { finish } = operations;

  const revalidate = useCallback(
    (next: Destination = listDestination, admitted?: ActiveErasure) => {
      invalidate();
      allowed.current = false;
      seenEpoch.current = undefined;
      setAvailable(false);
      setDestination(next);
      setErasure(admitted);
      activeGeneration.current += 1;
      setGeneration(activeGeneration.current);
    },
    [invalidate],
  );

  const discover = useCallback(
    async (signal: AbortSignal) => {
      if (operationId) return true;
      const isCurrent = () =>
        !signal.aborted && current() && generation === activeGeneration.current;
      let result: Awaited<ReturnType<MemoryApi["listActiveKnowledgeForgetOperations"]>>;
      try {
        result = await api.listActiveKnowledgeForgetOperations();
      } catch (error) {
        if (isCurrent()) throw error;
        return;
      }
      if (!isCurrent()) return;
      if (result[0]) {
        revalidate(listDestination, result[0]);
      } else {
        allowed.current = true;
        setAvailable(true);
      }
      return true;
    },
    [api, current, operationId, revalidate, generation],
  );
  const gate = useMemoryResource(discover);

  const access = useMemo<MemoryAccess>(
    () => ({
      capture: () => {
        const authorized = visit.capture();
        return () => authorized() && allowed.current;
      },
      recover(error, cursor) {
        const fenced = isErasureFence(error);
        if (!fenced && !(cursor && statusOf(error) === 409)) return false;
        revalidate();
        if (!fenced) toast.error("This memory page changed. Reloading saved memory.");
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

  function admitted(id: string | null, toastId: string) {
    revalidate(listDestination, id ? { operationId: id, status: "pending", toastId } : undefined);
  }

  if (erasure) {
    return (
      <>
        <Stack.Screen options={{ title: "Memory" }} />
        <ErasureStatus
          key={operationId}
          {...{ api, current, erasure }}
          onComplete={(feedbackId) => {
            if (operationToast && operationToast !== feedbackId)
              finish(operationToast, { message: "Memory forgotten." });
            revalidate();
          }}
          onBlocked={() => {
            if (operationToast)
              finish(operationToast, { message: "Erasure needs attention.", tone: "error" });
          }}
          retain={finish}
        />
      </>
    );
  }
  if (!available) {
    return (
      <MemoryBody>
        <Stack.Screen options={{ title: "Memory" }} />
        <MemoryReadState
          {...gate}
          label="memory availability"
          retry={() =>
            void gate.reload().catch(() => toast.error("Couldn’t check memory availability."))
          }
        />
      </MemoryBody>
    );
  }
  return (
    <PrivateMemory
      key={generation}
      {...{ api, access, admitted }}
      initial={destination}
      revalidate={revalidate}
      retain={finish}
    />
  );
}

function ErasureStatus({
  api,
  current,
  erasure,
  onComplete,
  onBlocked,
  retain,
}: {
  api: MemoryApi;
  current: () => boolean;
  erasure: ActiveErasure;
  onComplete: (feedbackId?: string) => void;
  onBlocked: () => void;
  retain: (id: string, feedback: Feedback) => void;
}) {
  const { operationId } = erasure;
  const mounted = useVisitAuthority(current);
  const commands = useMemoryCommands(mounted.capture);
  const [phase, setPhase] = useState<KnowledgeForgetStatus["status"]>(erasure.status);
  const callbacks = useRef({ onComplete, onBlocked });
  callbacks.current = { onComplete, onBlocked };
  const previous = useRef<string>(undefined);

  const update = useCallback((value: KnowledgeForgetStatus, feedbackId?: string) => {
    if (value.status === "completed") callbacks.current.onComplete(feedbackId);
    else if (value.status === "blocked" && previous.current !== "blocked")
      callbacks.current.onBlocked();
    previous.current = value.status;
    setPhase(value.status);
  }, []);

  useEffect(() => {
    const canPublish = mounted.capture();
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const value = await api.getKnowledgeForgetStatus({ operationId });
        if (stopped || !canPublish()) return;
        update(value);
        if (value.status !== "pending") return;
      } catch {
        // The explicit status command provides actionable feedback on demand.
      }
      if (!stopped && canPublish()) timer = setTimeout(() => void poll(), 4000);
    };
    if (phase === "pending" && !commands.busy) void poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [api, mounted.capture, operationId, phase, update, commands.busy]);

  function check(retry = false) {
    void commands.run({
      loading: retry ? "Retrying erasure…" : "Checking erasure status…",
      failure: retry ? "Couldn’t retry erasure." : "Couldn’t check erasure status.",
      request: () =>
        retry
          ? api.retryKnowledgeForget({ operationId })
          : api.getKnowledgeForgetStatus({ operationId }),
      complete: (value, toastId) => {
        update(value, toastId);
        if (value.status === "completed") {
          if (erasure.toastId) return;
          return { message: "Memory forgotten." };
        }
        return value.status === "blocked"
          ? { message: "Erasure needs attention.", tone: "error" }
          : { message: "Erasure is still in progress.", tone: "info" };
      },
      retain,
    });
  }

  return (
    <MemoryBody>
      <Heading>Forgetting</Heading>
      <Body>
        {phase === "blocked"
          ? "Memory access is paused during erasure."
          : "Memory is unavailable while erasure runs."}
      </Body>
      <Section>
        <SettingsActionRow
          label="Check erasure status"
          icon="refresh"
          onPress={() => check()}
          disabled={commands.busy}
        />
        {phase === "blocked" && (
          <SettingsActionRow
            label="Retry erasure"
            onPress={() => check(true)}
            disabled={commands.busy}
          />
        )}
      </Section>
    </MemoryBody>
  );
}

type PrivateProps = {
  api: MemoryApi;
  access: MemoryAccess;
  initial: Destination;
  revalidate: (next?: Destination, erasure?: ActiveErasure) => void;
  retain: (id: string, feedback: Feedback) => void;
  admitted: (id: string | null, toastId: string) => void;
};
function PrivateMemory({ api, access, initial, revalidate, retain, admitted }: PrivateProps) {
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
          {...{ api, access, open, retain, admitted }}
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
        onErasure={(result) => revalidate(listDestination, result)}
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
  onErasure: (operation: ActiveErasure) => void;
};
function MemoryList({ api, access, purpose, setPurpose, open, onAdd, onErasure }: ListProps) {
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
      {...{ api, access, query, load, open, onErasure }}
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
  onErasure,
  header,
  footer,
  add,
  disabled,
}: Pick<ListProps, "api" | "access" | "open" | "onErasure"> & {
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
    const current = access.capture();
    let active: Awaited<ReturnType<MemoryApi["listActiveKnowledgeForgetOperations"]>>;
    try {
      active = await api.listActiveKnowledgeForgetOperations();
    } catch (error) {
      if (current()) throw error;
      return;
    }
    if (!current()) return;
    if (active[0]) {
      onErasure(active[0]);
      return;
    }
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
