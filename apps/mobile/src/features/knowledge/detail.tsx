import {
  type KnowledgeLifecycleInput,
  type KnowledgeMutationResult,
  type KnowledgeRecord,
  type KnowledgeSource,
  knowledgeWorkspaceSchema,
} from "@personal-os/domain";
import { randomUUID } from "expo-crypto";
import { Stack } from "expo-router";
import { type RefObject, useCallback, useLayoutEffect, useState } from "react";
import { View } from "react-native";
import { toast } from "sonner-native";
import { Body, Facts, Heading } from "../../components/detail-content";
import { editorDismissOptions } from "../../components/editor-header";
import { confirmDiscard, Section, ToggleRow } from "../goals/controls";
import { SettingsActionRow } from "../settings/settings-row";
import {
  type Feedback,
  type MemoryAccess,
  type MemoryApi,
  readableMemory,
  readMemory,
  statusOf,
  useMemoryCommands,
  useMemoryResource,
} from "./authority";
import { MemoryBody, MemoryChoice, MemoryNote, MemoryReadState, MemoryText } from "./controls";
import { type EditMode, MemoryEditor } from "./editor";
import {
  linkedMemoryIds,
  memoryClaimFields,
  memoryContent,
  memoryDate,
  memoryFreshness,
  memoryLabel,
  memoryLabels,
  memoryStatus,
  memorySummary,
} from "./presentation";
import { confirmDeleteNow, confirmTrash, TrashedMemory } from "./trash";

/** The handler native back runs while a memory is open; the screen owns the gesture. */
export type BackHandler = RefObject<(() => void) | undefined>;
type Props = {
  api: MemoryApi;
  access: MemoryAccess;
  id: string;
  close: () => void;
  open: (id: string) => void;
  /** Reloads the visit, then shows this memory, or the list when none is given. */
  changed: (id?: string) => void;
  retain: (id: string, feedback: Feedback) => void;
  back: BackHandler;
};
type ActionBody = KnowledgeLifecycleInput extends infer T
  ? T extends KnowledgeLifecycleInput
    ? Omit<T, "mutationKey">
    : never
  : never;
const sensitivityLabels = { standard: "Standard", sensitive: "Sensitive" };

function scopeFields(record: KnowledgeRecord) {
  return [
    {
      label: "Workspace",
      value: record.scope.workspace ? memoryLabel(record.scope.workspace) : "All workspaces",
    },
    {
      label: "Uses",
      value: record.purposes.length ? record.purposes.map(memoryLabel).join(", ") : "Every use",
    },
  ];
}

function ClaimFacts({ record }: { record: KnowledgeRecord }) {
  return (
    <Facts
      facts={[
        ...memoryClaimFields(memoryContent(record)).map(([label, value]) => ({ label, value })),
        ...scopeFields(record),
      ]}
    />
  );
}

function savedBy(author: KnowledgeRecord["author"]) {
  return author.actorType === "user" ? "You" : `An agent (${author.actorId})`;
}

function sourceReference(source: KnowledgeSource) {
  const evidence = source.evidence;
  switch (evidence.type) {
    case "statement":
      return [
        evidence.wording,
        evidence.sessionRef && `Session ${evidence.sessionRef}`,
        evidence.messageRef && `Message ${evidence.messageRef}`,
      ]
        .filter(Boolean)
        .join("\n");
    case "observation":
      return evidence.reference;
    case "domain_record":
      return `${memoryLabel(evidence.domain)} ${evidence.id} · revision ${evidence.revision}`;
    case "signed_inbound_message":
      return evidence.id;
  }
}

function RecordFacts({ record }: { record: KnowledgeRecord }) {
  return (
    <>
      <ClaimFacts record={record} />
      <Facts
        facts={[
          { label: "Tags", value: record.tags.map((tag) => `#${tag}`).join(" ") || "None" },
          { label: "Saved by", value: savedBy(record.author) },
          { label: "Updated", value: memoryDate(record.createdAt) },
          ...(record.lastConfirmedAt
            ? [{ label: "Confirmed by you", value: memoryDate(record.lastConfirmedAt) }]
            : []),
          ...(record.validFrom
            ? [{ label: "Valid from", value: memoryDate(record.validFrom) }]
            : []),
          ...(record.validUntil
            ? [{ label: "Valid until", value: memoryDate(record.validUntil) }]
            : []),
          { label: "Revision", value: String(record.revision) },
        ]}
      />
      {record.sources.length ? (
        <Section title="Sources">
          {record.sources.map((source) => (
            <MemoryNote key={source.id}>
              {`${memoryLabel(source.classification)}\n${
                source.availability === "unavailable"
                  ? "Source unavailable"
                  : sourceReference(source)
              }`}
            </MemoryNote>
          ))}
        </Section>
      ) : (
        !record.evidenceAvailable && <MemoryText>Supporting evidence is unavailable.</MemoryText>
      )}
    </>
  );
}

export function MemoryDetail(props: Props) {
  const { api, access, id, close, back } = props;
  const load = useCallback(
    (signal: AbortSignal) => readMemory(access, signal, () => api.getKnowledge({ id })),
    [access, api, id],
  );
  const detail = useMemoryResource(load);
  const record = detail.value;
  useLayoutEffect(() => {
    if (!record || "state" in record) back.current = close;
  });
  if (record && !("state" in record))
    return (
      <RecordSession
        key={JSON.stringify(record)}
        {...props}
        record={record}
        refresh={detail.refresh}
      />
    );
  return (
    <MemoryBody>
      <Stack.Screen options={{ title: "Memory details" }} />
      <MemoryReadState
        {...detail}
        label="memory"
        retry={() => void detail.reload().catch(() => toast.error("Couldn’t load this memory."))}
      />
      {record && (
        <MemoryText>This memory was deleted, so there is nothing left to show.</MemoryText>
      )}
    </MemoryBody>
  );
}

type Linked = { id: string; title: string };
function useLinkedMemories(api: MemoryApi, access: MemoryAccess, record: KnowledgeRecord) {
  const ids = linkedMemoryIds(record).join(",");
  const load = useCallback(
    (signal: AbortSignal) =>
      readMemory(access, signal, () =>
        Promise.all(
          (ids ? ids.split(",") : []).map((id) =>
            api.getKnowledge({ id }).then(
              (result): Linked => ({
                id,
                title:
                  "state" in result
                    ? "A deleted memory"
                    : memorySummary(memoryContent(result)).title,
              }),
              (): Linked => ({ id, title: "A memory you can’t open" }),
            ),
          ),
        ),
      ),
    [access, api, ids],
  );
  return useMemoryResource(load);
}

function RecordSession({
  api,
  access,
  record,
  close,
  open,
  changed,
  retain,
  back,
  refresh,
}: Props & { record: KnowledgeRecord; refresh: () => Promise<unknown> }) {
  const id = record.id;
  const commands = useMemoryCommands(access.capture, access.recover);
  const [mode, setMode] = useState<"detail" | EditMode>("detail");
  const [dirty, setDirty] = useState(false);
  const [history, setHistory] = useState(false);
  const [baseline, setBaseline] = useState(record);
  const [conflict, setConflict] = useState<KnowledgeLifecycleInput>();
  const [reviewed, setReviewed] = useState<KnowledgeRecord>();
  const linked = useLinkedMemories(api, access, record);
  const identity = { recordId: id, expectedRevision: baseline.revision };

  function exitEdit() {
    setDirty(false);
    setMode("detail");
    setConflict(undefined);
    setReviewed(undefined);
  }
  function leave() {
    // Leaving during a write fences it: its result no longer reaches this screen.
    if (commands.busy || mode === "detail") close();
    else if (dirty) confirmDiscard(exitEdit);
    else exitEdit();
  }
  useLayoutEffect(() => {
    back.current = leave;
  });

  function update(
    body: ActionBody,
    {
      loading,
      success,
      next = (result) => (result.outcome === "readable" ? id : undefined),
      stale = "This memory changed. Showing the latest version.",
    }: {
      loading: string;
      success: string;
      /** The memory to show after the change, or none for the list. */
      next?: (result: KnowledgeMutationResult) => string | undefined;
      stale?: string;
    },
  ) {
    const input = { ...body, mutationKey: randomUUID() } as KnowledgeLifecycleInput;
    const editing = mode !== "detail";
    void commands.run({
      loading,
      failure: "Couldn’t confirm this change. Check the memory before trying again.",
      request: () => api.updateKnowledge(input),
      complete: (result) => {
        changed(next(result));
        const leaves = body.action === "trash" || body.action === "delete_now";
        return {
          message:
            leaves || result.outcome === "readable" ? success : "This memory is unavailable.",
        };
      },
      rejected: (error) => {
        const status = statusOf(error);
        if (status === 409 && editing) {
          // Keep the draft: the person reviews the latest revision before saving again.
          setConflict(input);
          setReviewed(undefined);
          return "Memory changed. Review the latest revision.";
        }
        if (status === 409) {
          changed(id);
          return stale;
        }
        if (status === 401 || status === 403 || status === 404) changed();
        return undefined;
      },
      retain,
    });
  }

  function reviewLatest() {
    void commands.run({
      loading: "Loading the latest memory…",
      failure: "Couldn’t load the latest memory.",
      request: () => api.getKnowledge({ id }).then(readableMemory),
      complete: (result) => {
        setReviewed(result);
        return { message: "Latest revision loaded.", tone: "info" };
      },
    });
  }

  const summary = memorySummary(memoryContent(baseline));
  const disabled = commands.busy || Boolean(conflict);

  if (mode !== "detail") {
    const recovery = conflict && (
      <Section title="Review concurrent changes">
        <MemoryNote>{`You edited revision ${conflict.expectedRevision}.`}</MemoryNote>
        {reviewed && (
          <View style={{ paddingHorizontal: 16 }}>
            <Heading>{`Current revision ${reviewed.revision}`}</Heading>
            <ClaimFacts record={reviewed} />
          </View>
        )}
        {reviewed ? (
          <SettingsActionRow
            label="Use this revision"
            onPress={() => {
              setBaseline(reviewed);
              setConflict(undefined);
              setReviewed(undefined);
            }}
            disabled={commands.busy}
          />
        ) : (
          <SettingsActionRow
            label="Load current revision"
            onPress={reviewLatest}
            disabled={commands.busy}
          />
        )}
      </Section>
    );
    return (
      <>
        <Stack.Screen
          options={{
            title: mode === "edit" ? "Edit memory" : "Replace memory",
            ...editorDismissOptions({ label: dirty ? "Cancel" : "Close", onPress: leave }),
          }}
        />
        <MemoryEditor
          mode={mode}
          record={baseline}
          disabled={disabled}
          onDirty={() => setDirty(true)}
          onSave={(input) => {
            if (!("action" in input)) return;
            const { mutationKey: _key, ...body } = input;
            update(body as ActionBody, {
              loading: input.action === "revise" ? "Saving memory…" : "Replacing memory…",
              success: input.action === "revise" ? "Memory saved." : "Memory replaced.",
            });
          }}
          onInvalid={() => toast.error("Check the memory fields and try again.")}
          layout={(fields, save) => (
            <MemoryBody save={save}>
              {recovery}
              {fields}
            </MemoryBody>
          )}
        />
      </>
    );
  }

  const trashedAt = baseline.trashedAt;
  const proposal = !trashedAt && baseline.status === "proposed";
  const live = !trashedAt && !proposal && baseline.status !== "superseded";
  const archived = baseline.status === "archived";
  const links = linked.value ?? [];
  return (
    <MemoryBody onRefresh={refresh}>
      <Stack.Screen
        options={{
          title: "Memory details",
          headerLeft: undefined,
          unstable_headerLeftItems: undefined,
        }}
      />
      <View>
        <Heading>{summary.title}</Heading>
        <Body>{summary.text}</Body>
        <Body>
          {[...memoryLabels(baseline), memoryStatus(baseline), memoryFreshness(baseline)]
            .filter(Boolean)
            .join(" · ")}
        </Body>
      </View>
      {trashedAt && (
        <TrashedMemory
          record={baseline}
          trashedAt={trashedAt}
          disabled={commands.busy}
          open={open}
          restore={() =>
            update(
              { action: "restore", ...identity },
              {
                loading: "Restoring memory…",
                success: "Memory restored.",
              },
            )
          }
          deleteNow={() => {
            const expectedTrashVersion = baseline.trashVersion;
            if (expectedTrashVersion === undefined) return;
            confirmDeleteNow(summary.title, () =>
              update(
                { action: "delete_now", ...identity, expectedTrashVersion },
                {
                  loading: "Deleting memory…",
                  success: "Memory deleted.",
                  next: () => undefined,
                  stale: "This memory changed in Trash. Review it before deleting.",
                },
              ),
            );
          }}
        />
      )}
      {proposal && (
        <Section title="Agent’s proposal">
          <MemoryNote>
            An agent proposed this change to a memory you hold. Your version stays in use until you
            choose.
          </MemoryNote>
          <SettingsActionRow
            label="Keep mine"
            icon="check"
            onPress={() =>
              update(
                { action: "resolve_conflict", ...identity, keep: "current" },
                {
                  loading: "Keeping your version…",
                  success: "Kept your version.",
                  next: () => baseline.conflictRecordIds[0],
                },
              )
            }
            disabled={disabled}
          />
          <SettingsActionRow
            label="Take the agent’s"
            icon="agent"
            onPress={() =>
              update(
                { action: "resolve_conflict", ...identity, keep: "proposed" },
                {
                  loading: "Taking the agent’s version…",
                  success: "Took the agent’s version.",
                },
              )
            }
            disabled={disabled}
          />
          {baseline.conflictRecordIds.map((conflictId) => (
            <SettingsActionRow
              key={conflictId}
              label="Open your version to edit it"
              icon="edit"
              onPress={() => open(conflictId)}
              disabled={commands.busy}
            />
          ))}
        </Section>
      )}
      {live && baseline.conflictRecordIds.length > 0 && (
        <Section title="Conflicts">
          {baseline.conflictRecordIds.map((conflictId) => (
            <SettingsActionRow
              key={conflictId}
              label="Review the agent’s proposal"
              icon="agent"
              onPress={() => open(conflictId)}
              disabled={commands.busy}
            />
          ))}
        </Section>
      )}
      {baseline.supersededBy && (
        <SettingsActionRow
          label="Open replacement memory"
          onPress={() => {
            if (baseline.supersededBy) open(baseline.supersededBy);
          }}
          disabled={commands.busy}
        />
      )}
      {live && (
        <Section title="Access">
          <ToggleRow
            label="Core memory"
            detail="Agents load it at the start of every session."
            value={baseline.core}
            onChange={(core) =>
              update(
                { action: "revise", ...identity, content: memoryContent(baseline), core },
                {
                  loading: "Updating memory…",
                  success: core ? "Added to core memory." : "Removed from core memory.",
                },
              )
            }
            disabled={disabled}
          />
          <ToggleRow
            label="Agents can use this"
            detail="When off, no agent can see this memory."
            value={baseline.agentAccess === "allowed"}
            onChange={(allowed) =>
              update(
                { action: "set_access", ...identity, agentAccess: allowed ? "allowed" : "blocked" },
                {
                  loading: "Updating agent access…",
                  success: allowed ? "Agents can use this memory." : "Hidden from agents.",
                },
              )
            }
            disabled={disabled}
          />
          <MemoryChoice
            label="Sensitivity"
            value={baseline.sensitivity}
            choices={["standard", "sensitive"]}
            labels={sensitivityLabels}
            onChange={(sensitivity) =>
              update(
                { action: "set_sensitivity", ...identity, sensitivity },
                {
                  loading: "Updating sensitivity…",
                  success: sensitivity === "sensitive" ? "Marked sensitive." : "Marked standard.",
                },
              )
            }
            disabled={disabled}
          />
          <MemoryChoice
            label="Workspace"
            value={baseline.scope.workspace ?? ""}
            choices={["", ...knowledgeWorkspaceSchema.options]}
            labels={{ "": "All workspaces" }}
            onChange={(workspace) =>
              update(
                // Narrowing from every workspace is a restriction; anything else widens.
                baseline.scope.workspace === null && workspace
                  ? { action: "restrict", ...identity, workspace }
                  : { action: "widen", ...identity, workspace: workspace || null },
                { loading: "Updating workspace…", success: "Workspace updated." },
              )
            }
            disabled={disabled}
          />
        </Section>
      )}
      {live && (
        <Section title="Review">
          <SettingsActionRow
            label="Edit memory"
            icon="edit"
            onPress={() => setMode("edit")}
            disabled={disabled}
          />
          {!archived && (!baseline.ownerHeld || baseline.status === "disputed") && (
            <SettingsActionRow
              label="Confirm memory"
              icon="check"
              onPress={() =>
                update(
                  { action: "confirm", ...identity },
                  {
                    loading: "Confirming memory…",
                    success: "Memory confirmed.",
                  },
                )
              }
              disabled={disabled}
            />
          )}
          {baseline.status === "active" && (
            <SettingsActionRow
              label="Dispute memory"
              icon="cancel"
              onPress={() =>
                update(
                  { action: "dispute", ...identity },
                  {
                    loading: "Disputing memory…",
                    success: "Memory disputed.",
                  },
                )
              }
              disabled={disabled}
            />
          )}
          {!archived && (
            <SettingsActionRow
              label="Replace with another memory"
              icon="views"
              onPress={() => setMode("supersede")}
              disabled={disabled}
            />
          )}
          <SettingsActionRow
            label={archived ? "Unarchive memory" : "Archive memory"}
            icon="archive"
            onPress={() =>
              update(
                archived
                  ? { action: "unarchive", ...identity }
                  : { action: "archive", ...identity },
                {
                  loading: archived ? "Unarchiving memory…" : "Archiving memory…",
                  success: archived ? "Memory unarchived." : "Memory archived.",
                },
              )
            }
            disabled={disabled}
          />
        </Section>
      )}
      <RecordFacts record={baseline} />
      {links.length > 0 && (
        <Section title="Linked memories">
          {links.map((link) => (
            <SettingsActionRow
              key={link.id}
              label={link.title}
              onPress={() => open(link.id)}
              disabled={commands.busy}
            />
          ))}
        </Section>
      )}
      <SettingsActionRow
        label={history ? "Hide revision history" : "Revision history"}
        icon="history"
        onPress={() => setHistory(!history)}
        disabled={commands.busy}
      />
      {history && <History api={api} access={access} id={id} />}
      {!trashedAt && !proposal && (
        <SettingsActionRow
          label="Move to Trash"
          icon="trash"
          destructive
          onPress={() =>
            confirmTrash(
              summary.title,
              linked.value
                ? links.map((link) => link.title)
                : linkedMemoryIds(baseline).map((linkedId) => `Memory ${linkedId}`),
              () =>
                update(
                  { action: "trash", ...identity },
                  {
                    loading: "Moving to Trash…",
                    success: "Moved to Trash.",
                    next: () => undefined,
                  },
                ),
            )
          }
          disabled={disabled}
        />
      )}
    </MemoryBody>
  );
}

function History({ api, access, id }: Pick<Props, "api" | "access" | "id">) {
  const load = useCallback(
    (signal: AbortSignal) =>
      readMemory(access, signal, () => api.getKnowledgeHistory({ recordId: id }), {
        epoch: (page) => page.epoch,
      }),
    [access, api, id],
  );
  const initial = useMemoryResource(load);
  const [pages, setPages] = useState<Awaited<ReturnType<MemoryApi["getKnowledgeHistory"]>>[]>([]);
  const commands = useMemoryCommands(access.capture, access.recover);
  const cursor = (pages.at(-1) ?? initial.value)?.nextCursor;
  return (
    <View style={{ gap: 16 }}>
      <MemoryReadState
        {...initial}
        label="revision history"
        retry={() =>
          void initial.reload().catch(() => toast.error("Couldn’t load revision history."))
        }
      />
      {initial.value &&
        [initial.value, ...pages]
          .flatMap((page) => page.items)
          .map((item) => (
            <View key={item.revision}>
              <Heading>{`Revision ${item.revision}`}</Heading>
              <Body>
                {[
                  memorySummary(memoryContent(item)).text,
                  savedBy(item.author),
                  memoryDate(item.createdAt),
                ].join(" · ")}
              </Body>
              <ClaimFacts record={item} />
            </View>
          ))}
      {cursor && (
        <SettingsActionRow
          label="Load older revisions"
          disabled={commands.busy}
          onPress={() =>
            void commands.run({
              loading: "Loading older revisions…",
              failure: "Couldn’t load older revisions.",
              cursor: true,
              request: () => api.getKnowledgeHistory({ recordId: id, cursor }),
              complete: (result) => {
                if (!access.observe(result)) return;
                setPages((previous) => [...previous, result]);
                return { message: "Older revisions loaded.", tone: "info" };
              },
            })
          }
        />
      )}
    </View>
  );
}
