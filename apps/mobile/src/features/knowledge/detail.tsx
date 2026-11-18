import type {
  KnowledgeLifecycleInput,
  KnowledgeRecord,
  KnowledgeSource,
} from "@personal-os/domain";
import { randomUUID } from "expo-crypto";
import { Stack, usePreventRemove } from "expo-router";
import { useCallback, useState } from "react";
import { View } from "react-native";
import { toast } from "sonner-native";
import { Body, Facts, Heading } from "../../components/detail-content";
import { editorDismissOptions } from "../../components/editor-header";
import { confirmDiscard, Section } from "../goals/controls";
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
    { label: "Sensitivity", value: record.sensitivity === "sensitive" ? "Sensitive" : "Standard" },
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

export function MemoryDetail({ api, access, selection, close, open, changed, retain }: Props) {
  const { id, purpose } = selection;
  const load = useCallback(
    (signal: AbortSignal) =>
      readMemory(access, signal, () => api.getKnowledge({ id, purpose }).then(readableMemory)),
    [access, api, id, purpose],
  );
  const detail = useMemoryResource(load);
  const record = detail.value;
  return record ? (
    <RecordSession {...{ api, access, selection, close, open, changed, retain, record }} />
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

const saveMessages: Record<KnowledgeLifecycleInput["action"], string> = {
  revise: "Memory saved.",
  confirm: "Memory confirmed.",
  dispute: "Memory disputed.",
  restrict: "Memory use restricted.",
  widen: "Memory use widened.",
  supersede: "Memory superseded.",
  archive: "Memory archived.",
  unarchive: "Memory unarchived.",
  raise_sensitivity: "Memory marked sensitive.",
  set_sensitivity: "Memory sensitivity updated.",
  set_access: "Agent access updated.",
  resolve_conflict: "Conflict resolved.",
  trash: "Memory moved to Trash.",
  restore: "Memory restored.",
  delete_now: "Memory deleted.",
};

function RecordSession({
  api,
  access,
  selection,
  close,
  open,
  changed,
  retain,
  record,
}: Props & { record: KnowledgeRecord }) {
  const { id, purpose } = selection;
  const commands = useMemoryCommands(access.capture, access.recover);
  const mutationKey = useMutationKey();
  const [mode, setMode] = useState<"detail" | EditMode>("detail");
  const [dirty, setDirty] = useState(false);
  const [history, setHistory] = useState(false);
  const [baseline, setBaseline] = useState(record);
  const [conflict, setConflict] = useState<KnowledgeLifecycleInput>();
  const [reviewed, setReviewed] = useState<KnowledgeRecord>();

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
        const readable = result.outcome === "readable";
        changed(readable ? selection : undefined);
        return {
          message: readable ? saveMessages[input.action] : "This memory is unavailable.",
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
      request: () => api.getKnowledge({ id, purpose }).then(readableMemory),
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
            {baseline.status !== "active" ? (
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
      <SettingsActionRow label="Back to memory" onPress={close} />
    </MemoryBody>
  );
}

function submittedFields(input: KnowledgeLifecycleInput, record: KnowledgeRecord) {
  const fields = memoryClaimFields(
    input.action === "revise" ? input.content : memoryContent(record),
  ).map(([label, value]) => ({ label, value }));
  const scope =
    input.action === "restrict" || input.action === "widen"
      ? { workspace: input.workspace }
      : record.scope;
  fields.push(...permissionFields({ ...record, scope }));
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
