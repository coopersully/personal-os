import type {
  KnowledgeForgetPreview,
  KnowledgeLifecycleInput,
  KnowledgeRecord,
  KnowledgeSource,
} from "@personal-os/domain";
import { randomUUID } from "expo-crypto";
import { Stack, usePreventRemove } from "expo-router";
import { useCallback, useState } from "react";
import { Alert, View } from "react-native";
import { toast } from "sonner-native";
import { Body, Facts, Heading } from "../../components/detail-content";
import { editorDismissOptions } from "../../components/editor-header";
import { confirmDiscard, Section } from "../goals/controls";
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
} from "./authority";
import { MemoryBody, MemoryReadState, MemoryText } from "./controls";
import { type EditMode, MemoryEditor } from "./editor";
import {
  memoryAcceptance,
  memoryClaimFields,
  memoryContent,
  memoryLabel,
  memoryState,
  memorySummary,
} from "./presentation";

export type Selection = { id: string; purpose: KnowledgeRecord["purposes"][number] };
type Props = {
  api: MemoryApi;
  access: MemoryAccess;
  selection: Selection;
  close: () => void;
  open: (id: string) => void;
  changed: (selection?: Selection) => void;
  retain: (id: string, feedback: Feedback) => void;
  admitted: (operationId: string | null, toastId: string) => void;
};

function dateLabel(date: string) {
  return new Date(date).toLocaleDateString(undefined, { dateStyle: "medium" });
}

function permissionFields(record: KnowledgeRecord) {
  return [
    {
      label: "Workspace",
      value: record.scope.workspace ? memoryLabel(record.scope.workspace) : "All workspaces",
    },
    {
      label: "Visibility",
      value: record.sensitivity === "sensitive" ? "Only me" : "Authorized agents",
    },
    { label: "Allowed uses", value: record.purposes.map(memoryLabel).join(", ") },
  ];
}

function ClaimFacts({ record }: { record: KnowledgeRecord }) {
  return (
    <Facts
      facts={[
        ...memoryClaimFields(memoryContent(record)).map(([label, value]) => ({ label, value })),
        ...permissionFields(record),
      ]}
    />
  );
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

function RecordFacts({
  record,
  historical = false,
}: {
  record: KnowledgeRecord;
  historical?: boolean;
}) {
  const summary = memorySummary(memoryContent(record));
  return (
    <View>
      <Heading>{historical ? `Revision ${record.revision}` : summary.title}</Heading>
      {!historical && <Body>{summary.text}</Body>}
      <Body>
        {memoryLabel(record.origin)} · {memoryState(record)}
      </Body>
      <Body>{memoryAcceptance(record)}</Body>
      <ClaimFacts record={record} />
      <Facts
        facts={[
          {
            label: "Contributor",
            value: record.author.actorType === "user" ? "You" : `Agent ${record.author.actorId}`,
          },
          { label: "Revision", value: String(record.revision) },
          { label: "Saved", value: dateLabel(record.createdAt) },
          ...(record.acceptance
            ? [{ label: "Accepted", value: dateLabel(record.acceptance.acceptedAt) }]
            : []),
          ...(record.reviewAt ? [{ label: "Review", value: dateLabel(record.reviewAt) }] : []),
          ...(record.validFrom
            ? [{ label: "Valid from", value: dateLabel(record.validFrom) }]
            : []),
          ...(record.validUntil
            ? [{ label: "Valid until", value: dateLabel(record.validUntil) }]
            : []),
        ]}
      />
      {record.sources.length ? (
        <Section title="Sources">
          <View style={{ padding: 16, gap: 12 }}>
            {record.sources.map((source) => (
              <MemoryText key={source.id}>
                {memoryLabel(source.classification)}
                {source.availability === "unavailable"
                  ? "\nSource unavailable"
                  : `\n${sourceReference(source)}`}
              </MemoryText>
            ))}
          </View>
        </Section>
      ) : (
        !record.evidenceAvailable && <MemoryText>Supporting evidence is unavailable.</MemoryText>
      )}
    </View>
  );
}

export function MemoryDetail({
  api,
  access,
  selection,
  close,
  open,
  changed,
  retain,
  admitted,
}: Props) {
  const { id, purpose } = selection;
  const load = useCallback(
    (signal: AbortSignal) => readMemory(access, signal, () => api.getKnowledge({ id, purpose })),
    [access, api, id, purpose],
  );
  const detail = useMemoryResource(load);
  const record = detail.value;
  return record ? (
    <RecordSession
      {...{ api, access, selection, close, open, changed, retain, admitted, record }}
    />
  ) : (
    <MemoryBody>
      <MemoryReadState
        {...detail}
        label="memory"
        retry={() => void detail.reload().catch(() => {})}
      />
      <SettingsActionRow label="Back to memory" onPress={close} />
    </MemoryBody>
  );
}

const saveMessages = {
  revise: "Memory saved.",
  confirm: "Memory confirmed.",
  dispute: "Memory disputed.",
  restrict: "Memory use restricted.",
  supersede: "Memory superseded.",
};

function RecordSession({
  api,
  access,
  selection,
  close,
  open,
  changed,
  retain,
  admitted,
  record,
}: Props & { record: KnowledgeRecord }) {
  const { id, purpose } = selection;
  const commands = useMemoryCommands(access.capture, access.recover);
  const mutationKey = useMutationKey();
  const forgetKey = useMutationKey();
  const [mode, setMode] = useState<"detail" | "forget" | EditMode>("detail");
  const [dirty, setDirty] = useState(false);
  const [history, setHistory] = useState(false);
  const [baseline, setBaseline] = useState(record);
  const [conflict, setConflict] = useState<KnowledgeLifecycleInput>();
  const [reviewed, setReviewed] = useState<KnowledgeRecord>();
  const [previewPages, setPreviewPages] = useState<KnowledgeForgetPreview[]>([]);
  const [previewIndex, setPreviewIndex] = useState(0);
  const [previewStale, setPreviewStale] = useState(false);
  const preview = previewPages[previewIndex];

  function back() {
    if (dirty && !commands.busy) confirmDiscard(close);
    else close();
  }
  usePreventRemove(dirty && !commands.busy, ({ repeat }) => {
    confirmDiscard(() => {
      setDirty(false);
      repeat();
    });
  });

  function save(input: KnowledgeLifecycleInput) {
    const { mutationKey: _key, ...body } = input;
    void commands.run({
      loading: input.action === "revise" ? "Saving memory…" : "Updating memory…",
      failure: "Couldn’t confirm this update. You can retry the same changes.",
      request: () => api.updateKnowledge({ ...input, mutationKey: mutationKey(body) }),
      complete: (result) => {
        const readable = result.outcome === "readable" && result.record.purposes.includes(purpose);
        changed(readable ? selection : undefined);
        return {
          message:
            result.outcome === "pending_owner_review"
              ? "Memory saved for review."
              : result.outcome === "readable"
                ? saveMessages[input.action]
                : "This memory is unavailable.",
        };
      },
      rejected: (error) => {
        if (statusOf(error) === 409) {
          setConflict(input);
          setReviewed(undefined);
          return "Memory changed. Review the latest revision.";
        }
        if ([401, 403, 404].includes(statusOf(error) ?? 0)) changed();
      },
      retain,
    });
  }

  function reviewLatest() {
    void commands.run({
      loading: "Loading the latest memory…",
      failure: "Couldn’t load the latest memory.",
      request: () => api.getKnowledge({ id, purpose }),
      complete: (result) => {
        setReviewed(result);
        return { message: "Latest revision loaded.", tone: "info" };
      },
      rejected: (error) => {
        if ([401, 403, 404].includes(statusOf(error) ?? 0)) changed();
      },
    });
  }

  function simple(action: "confirm" | "dispute") {
    if (conflict) return;
    save({ action, recordId: id, expectedRevision: baseline.revision, mutationKey: randomUUID() });
  }

  function loadPreview(cursor?: KnowledgeForgetPreview["nextCursor"]) {
    void commands.run({
      loading: "Preparing forgetting preview…",
      failure: "Couldn’t load the forgetting preview.",
      cursor: Boolean(cursor),
      request: () => api.previewKnowledgeForget({ recordId: id, ...(cursor ? { cursor } : {}) }),
      complete: (result) => {
        if (!access.observe({ epoch: result.ownerEpoch })) return;
        if (cursor) {
          setPreviewPages((pages) => [...pages, result]);
          setPreviewIndex((page) => page + 1);
        } else {
          setPreviewPages([result]);
          setPreviewIndex(0);
        }
        setPreviewStale(false);
        setMode("forget");
        return { message: "Forgetting preview ready.", tone: "info" };
      },
    });
  }

  function forget() {
    if (!preview || previewStale) return;
    const body = { previewId: preview.previewId, ownerEpoch: preview.ownerEpoch };
    Alert.alert(
      "Permanently forget this memory?",
      "Its revision history and derived copies will be erased.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Forget",
          style: "destructive",
          onPress: () =>
            void commands.run({
              loading: "Requesting erasure…",
              failure: "Couldn’t confirm the request. You can retry this preview.",
              request: () => api.forgetKnowledge({ ...body, mutationKey: forgetKey(body) }),
              complete: (result, toastId) => {
                if (result.outcome === "pending_erasure") {
                  admitted(result.operationId, toastId);
                  return { message: "Forgetting in progress.", tone: "info" };
                }
                if (result.outcome === "forgotten") {
                  admitted(null, toastId);
                  return { message: "Memory forgotten." };
                }
                return { message: "Couldn’t confirm erasure.", tone: "error" };
              },
              rejected: (error) => {
                if ([404, 409].includes(statusOf(error) ?? 0)) {
                  setPreviewStale(true);
                  setPreviewPages([]);
                  return "The preview changed. Refresh it before forgetting.";
                }
                if (statusOf(error) === 503) return "Forgetting is temporarily unavailable.";
              },
              retain,
            }),
        },
      ],
    );
  }

  const disabled = commands.busy || Boolean(conflict);
  const header = (
    <Stack.Screen
      options={editorDismissOptions({ label: dirty ? "Cancel" : "Close", onPress: back })}
    />
  );
  const recovery = conflict && (
    <Section title="Review concurrent changes">
      <View style={{ padding: 16, gap: 12 }}>
        <Heading>Submitted revision {conflict.expectedRevision}</Heading>
        <Facts facts={submittedFields(conflict, baseline)} />
        {reviewed && (
          <>
            <Heading>Current revision {reviewed.revision}</Heading>
            <ClaimFacts record={reviewed} />
          </>
        )}
      </View>
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

  if (mode === "edit" || mode === "restrict" || mode === "supersede") {
    return (
      <>
        {header}
        <MemoryEditor
          mode={mode}
          record={baseline}
          purpose={purpose}
          disabled={disabled}
          onDirty={() => setDirty(true)}
          onSave={(input) => {
            if ("action" in input) save(input);
          }}
          onInvalid={() => toast.error("Check the memory fields and try again.")}
          layout={(fields, saveControl) => (
            <MemoryBody save={saveControl}>
              {recovery}
              {fields}
              <SettingsActionRow label="Back to memory" onPress={back} />
            </MemoryBody>
          )}
        />
      </>
    );
  }

  if (mode === "forget") {
    return (
      <MemoryBody>
        {header}
        <Heading>Forget memory?</Heading>
        <MemoryText>
          Forgetting erases this memory, its history and derived copies. Independent sources and
          exported files remain.
        </MemoryText>
        {preview && (
          <>
            <Facts
              facts={[
                { label: "Derived copies", value: String(preview.dependentCopyCount) },
                { label: "Revisions", value: String(preview.historyCount) },
              ]}
            />
            <Section title={`Affected revisions · page ${previewIndex + 1}`}>
              <View style={{ padding: 16, gap: 8 }}>
                {preview.affected.map((item) => (
                  <MemoryText key={`${item.recordId}:${item.revision}`}>
                    {item.recordId} · revision {item.revision}
                  </MemoryText>
                ))}
              </View>
              {previewIndex > 0 && (
                <SettingsActionRow
                  label="Previous preview page"
                  onPress={() => setPreviewIndex(previewIndex - 1)}
                  disabled={commands.busy}
                />
              )}
              {(preview.nextCursor || previewPages[previewIndex + 1]) && (
                <SettingsActionRow
                  label="Next preview page"
                  disabled={commands.busy}
                  onPress={() => {
                    if (previewPages[previewIndex + 1]) setPreviewIndex(previewIndex + 1);
                    else if (preview.nextCursor) loadPreview(preview.nextCursor);
                  }}
                />
              )}
            </Section>
            <SettingsActionRow
              label="Forget memory"
              icon="trash"
              destructive
              disabled={commands.busy || previewStale}
              onPress={forget}
            />
          </>
        )}
        {previewStale && (
          <SettingsActionRow
            label="Refresh forgetting preview"
            onPress={() => loadPreview()}
            disabled={commands.busy}
          />
        )}
        <SettingsActionRow label="Back to memory" onPress={back} />
      </MemoryBody>
    );
  }

  const mutable = baseline.status !== "superseded" && baseline.status !== "expired";
  return (
    <MemoryBody>
      <RecordFacts record={baseline} />
      {recovery}
      {baseline.conflictRecordIds.length > 0 && (
        <Section title="Conflicting memory">
          {baseline.conflictRecordIds.map((conflictId) => (
            <SettingsActionRow
              key={conflictId}
              label={`Inspect conflict ${conflictId}`}
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
      <Section title="Review">
        {mutable && (
          <>
            <SettingsActionRow
              label="Edit memory"
              icon="edit"
              onPress={() => setMode("edit")}
              disabled={disabled}
            />
            {baseline.status !== "active" || baseline.stale ? (
              <SettingsActionRow
                label="Confirm memory"
                icon="check"
                onPress={() => simple("confirm")}
                disabled={disabled}
              />
            ) : null}
            {baseline.status !== "disputed" && (
              <SettingsActionRow
                label={baseline.status === "proposed" ? "Reject proposal" : "Dispute memory"}
                onPress={() => simple("dispute")}
                disabled={disabled}
              />
            )}
            <SettingsActionRow
              label="Restrict memory use"
              onPress={() => setMode("restrict")}
              disabled={disabled}
            />
            <SettingsActionRow
              label="Supersede memory"
              onPress={() => setMode("supersede")}
              disabled={disabled}
            />
          </>
        )}
        <SettingsActionRow
          label={history ? "Hide revision history" : "Revision history"}
          icon="history"
          onPress={() => setHistory(!history)}
          disabled={commands.busy}
        />
      </Section>
      {history && <History {...{ api, access, selection }} />}
      <Section title="Erasure">
        <SettingsActionRow
          label="Preview forgetting"
          icon="trash"
          destructive
          onPress={() => loadPreview()}
          disabled={disabled}
        />
      </Section>
      <SettingsActionRow label="Back to memory" onPress={close} />
    </MemoryBody>
  );
}

function submittedFields(input: KnowledgeLifecycleInput, record: KnowledgeRecord) {
  const fields = memoryClaimFields(
    input.action === "revise" ? input.content : memoryContent(record),
  ).map(([label, value]) => ({ label, value }));
  const restricted = input.action === "restrict" ? input.restrictions : undefined;
  fields.push(
    ...permissionFields({
      ...record,
      scope: restricted?.scope ?? record.scope,
      sensitivity: restricted?.sensitivity ?? record.sensitivity,
      purposes: restricted?.purposes ?? record.purposes,
    }),
  );
  if (input.action === "supersede")
    fields.push({ label: "Replacement memory ID", value: input.replacementId });
  return fields;
}

function History({ api, access, selection }: Pick<Props, "api" | "access" | "selection">) {
  const { id, purpose } = selection;
  const load = useCallback(
    (signal: AbortSignal) =>
      readMemory(access, signal, () => api.getKnowledgeHistory({ recordId: id, purpose }), {
        epoch: (page) => page.epoch,
      }),
    [access, api, id, purpose],
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
        retry={() => void initial.reload().catch(() => {})}
      />
      {initial.value &&
        [initial.value, ...pages]
          .flatMap((page) => page.items)
          .map((item) => <RecordFacts key={item.revision} record={item} historical />)}
      {cursor && (
        <SettingsActionRow
          label="Load older revisions"
          disabled={commands.busy}
          onPress={() =>
            void commands.run({
              loading: "Loading older revisions…",
              failure: "Couldn’t load older revisions.",
              cursor: true,
              request: () => api.getKnowledgeHistory({ recordId: id, purpose, cursor }),
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
