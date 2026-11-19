import {
  type KnowledgeLifecycleInput,
  type KnowledgeMutationInput,
  type KnowledgeRecord,
  knowledgeLifecycleInputSchema,
  knowledgeMutationInputSchema,
  knowledgePurposeSchema,
  knowledgeTagsInputSchema,
  knowledgeWorkspaceSchema,
} from "@personal-os/domain";
import { randomUUID } from "expo-crypto";
import { useState } from "react";
import { View } from "react-native";
import { FormSave } from "../../components/forms/form-save";
import { Field, Section, ToggleRow } from "../goals/controls";
import { SettingsActionRow } from "../settings/settings-row";
import { MemoryChoice, MemoryNote, MemoryText } from "./controls";
import {
  contentDraft,
  contentFields,
  type DraftConflict,
  fieldDraft,
  type Kind,
  memoryContent,
  memoryKinds,
  memoryLabel,
  memorySummary,
  rebaseClaim,
  valueTypes,
} from "./presentation";

type Purpose = KnowledgeRecord["purposes"][number];
type Scope = KnowledgeRecord["scope"]["workspace"];
type Sensitivity = KnowledgeRecord["sensitivity"];
export type EditMode = "edit" | "supersede";
const visibilityLabels = { standard: "Standard", sensitive: "Sensitive" };

/** Tags typed as a comma-separated list; the API normalizes and files them. */
function tagsDraft(text: string, record?: KnowledgeRecord) {
  const parsed = knowledgeTagsInputSchema.safeParse(
    text
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean),
  );
  const changed =
    !record ||
    !parsed.success ||
    JSON.stringify([...parsed.data].sort()) !== JSON.stringify([...record.tags].sort());
  return { tags: parsed.success ? parsed.data : undefined, changed };
}

type PermissionDraft = {
  workspace: Scope;
  purposes: Purpose[];
  sensitivity: Sensitivity;
  core: boolean;
};
const emptyPermissions: PermissionDraft = {
  workspace: null,
  purposes: [],
  sensitivity: "standard",
  core: false,
};

function Permissions({
  value,
  change,
  disabled,
}: {
  value: PermissionDraft;
  change: (value: PermissionDraft) => void;
  disabled: boolean;
}) {
  return (
    <>
      <Section title="Access">
        <MemoryChoice
          label="Workspace"
          value={value.workspace ?? ""}
          choices={["", ...knowledgeWorkspaceSchema.options]}
          labels={{ "": "All workspaces" }}
          onChange={(workspace) => change({ ...value, workspace: workspace || null })}
          disabled={disabled}
        />
        <MemoryChoice
          label="Sensitivity"
          value={value.sensitivity}
          choices={["standard", "sensitive"]}
          labels={visibilityLabels}
          onChange={(sensitivity) =>
            // Sensitive memory never loads at session start, so it is never core.
            change({
              ...value,
              sensitivity,
              core: sensitivity === "sensitive" ? false : value.core,
            })
          }
          disabled={disabled}
        />
        <ToggleRow
          label="Core memory"
          detail={
            value.sensitivity === "sensitive"
              ? "Sensitive memories never load at session start."
              : "Agents load it at the start of every session."
          }
          value={value.core}
          onChange={(core) => change({ ...value, core })}
          disabled={disabled || value.sensitivity === "sensitive"}
        />
      </Section>
      <Section title="Uses (leave all off for every use)">
        {knowledgePurposeSchema.options.map((purpose) => (
          <ToggleRow
            key={purpose}
            label={memoryLabel(purpose)}
            value={value.purposes.includes(purpose)}
            onChange={(allowed) =>
              change({
                ...value,
                purposes: allowed
                  ? [...value.purposes, purpose]
                  : value.purposes.filter((item) => item !== purpose),
              })
            }
            disabled={disabled}
          />
        ))}
      </Section>
    </>
  );
}

export function MemoryEditor({
  mode,
  record,
  initial,
  disabled,
  onDirty,
  onSave,
  onInvalid,
  layout,
}: {
  mode: "add" | EditMode;
  record?: KnowledgeRecord;
  /** Content to start editing from instead of the record's, such as an agent's proposal. */
  initial?: KnowledgeRecord["content"];
  disabled: boolean;
  onDirty: () => void;
  onSave: (input: KnowledgeLifecycleInput | KnowledgeMutationInput) => void;
  onInvalid: () => void;
  layout: (fields: React.ReactNode, save: React.ReactNode) => React.ReactNode;
}) {
  const original = record && memoryContent(record);
  const start = initial ?? original;
  const [kind, setKind] = useState<Kind>(start?.kind ?? "fact");
  const [draft, setDraft] = useState(() => fieldDraft(start));
  const [permissions, setPermissions] = useState(emptyPermissions);
  const [replacementId, setReplacementId] = useState("");
  const [tagText, setTagText] = useState(record?.tags.join(", ") ?? "");
  const [dirty, setDirty] = useState(Boolean(initial));
  const [invalid, setInvalid] = useState(false);
  // The revision the draft is based on, and the fields it and a newer one both changed.
  const [base, setBase] = useState(record);
  const [choices, setChoices] = useState<DraftConflict[]>([]);
  if (record && base && record !== base) {
    // The person accepted a newer revision while editing: carry the draft onto it.
    if (mode !== "supersede") {
      const claim = rebaseClaim(memoryContent(base), memoryContent(record), {
        kind,
        fields: draft,
      });
      const mine = tagsDraft(tagText, base);
      const theirs = record.tags.join(", ");
      const tagConflict =
        mine.changed && tagsDraft(theirs, base).changed && tagsDraft(tagText, record).changed;
      setKind(claim.kind);
      setDraft(claim.fields);
      if (!mine.changed) setTagText(theirs);
      setChoices([
        ...claim.conflicts,
        ...(tagConflict ? [{ field: "tags", label: "Tags", mine: tagText, theirs }] : []),
      ]);
    }
    setBase(record);
  }
  const parsed = contentDraft(kind, draft, original);
  const tags = tagsDraft(tagText, record);
  const claimUnchanged = parsed.success && JSON.stringify(parsed.data) === JSON.stringify(original);
  const unchanged = mode === "edit" && claimUnchanged && !tags.changed;

  function change(apply: () => void) {
    if (disabled) return;
    setDirty(true);
    onDirty();
    apply();
  }

  /** Settles a field both versions changed: the person's value, or the newer revision's. */
  function choose(conflict: DraftConflict, theirs: boolean) {
    change(() => {
      setChoices((current) => current.filter((entry) => entry.field !== conflict.field));
      if (!theirs || !record) return;
      if (conflict.field === "tags") setTagText(conflict.theirs);
      else if (conflict.field === "claim") {
        const content = memoryContent(record);
        setKind(content.kind);
        setDraft(fieldDraft(content));
      } else setDraft((fields) => ({ ...fields, [conflict.field]: conflict.theirs }));
    });
  }

  function submit() {
    if (disabled || !dirty || unchanged || choices.length) return;
    const mutationKey = randomUUID();
    const identity = record
      ? { recordId: record.id, expectedRevision: record.revision, mutationKey }
      : null;
    const input =
      mode === "supersede"
        ? knowledgeLifecycleInputSchema.safeParse({
            ...identity,
            action: "supersede",
            replacementId: replacementId.trim(),
          })
        : parsed.success && tags.tags
          ? claimInput(parsed.data, permissions, tags, mutationKey, identity, !claimUnchanged)
          : undefined;
    if (!input?.success) {
      setInvalid(true);
      onInvalid();
      return;
    }
    setInvalid(false);
    onSave(input.data);
  }

  const typed = kind === "fact" || kind === "preference";
  return layout(
    <>
      {choices.length > 0 && record && (
        <Section title="Choose what to keep">
          {choices.map((conflict) => {
            const label = conflict.label.toLowerCase();
            return (
              <View key={conflict.field}>
                <MemoryNote>
                  {`${conflict.label}\nYours: ${conflict.mine}\nRevision ${record.revision}: ${conflict.theirs}`}
                </MemoryNote>
                <SettingsActionRow
                  label={`Keep my ${label}`}
                  onPress={() => choose(conflict, false)}
                  disabled={disabled}
                />
                <SettingsActionRow
                  label={`Use the current ${label}`}
                  onPress={() => choose(conflict, true)}
                  disabled={disabled}
                />
              </View>
            );
          })}
        </Section>
      )}
      {mode === "supersede" ? (
        <Section title="Replacement">
          <Field
            label="Replacement memory ID"
            value={replacementId}
            onChange={(value) => change(() => setReplacementId(value))}
            disabled={disabled}
          />
        </Section>
      ) : (
        <Section title="Memory">
          <MemoryChoice
            label="Memory type"
            value={kind}
            choices={memoryKinds}
            onChange={(value) =>
              change(() => {
                setKind(value);
                setDraft(fieldDraft());
              })
            }
            disabled={disabled}
          />
          {contentFields[kind].map(({ name, label, choices, multi }) =>
            choices ? (
              <MemoryChoice
                key={name}
                label={label}
                value={draft[name] ?? choices[0] ?? ""}
                choices={choices}
                onChange={(value) =>
                  change(() => setDraft((fields) => ({ ...fields, [name]: value })))
                }
                disabled={disabled}
              />
            ) : (
              <Field
                key={name}
                label={label}
                value={draft[name] ?? ""}
                multiline={multi}
                onChange={(value) =>
                  change(() => setDraft((fields) => ({ ...fields, [name]: value })))
                }
                disabled={disabled}
              />
            ),
          )}
          {typed && (
            <>
              <MemoryChoice
                label="Value type"
                value={draft.valueType ?? "string"}
                choices={valueTypes}
                onChange={(value) =>
                  change(() => setDraft((fields) => ({ ...fields, valueType: value, value: "" })))
                }
                disabled={disabled}
              />
              {draft.valueType === "boolean" ? (
                <ToggleRow
                  label="Value"
                  value={draft.value !== "false"}
                  onChange={(value) =>
                    change(() => setDraft((fields) => ({ ...fields, value: String(value) })))
                  }
                  disabled={disabled}
                />
              ) : (
                <Field
                  label="Value"
                  value={draft.value ?? ""}
                  onChange={(value) => change(() => setDraft((fields) => ({ ...fields, value })))}
                  disabled={disabled}
                  placeholder={draft.valueType === "date" ? "2026-01-31" : undefined}
                />
              )}
            </>
          )}
          <Field
            label="Tags"
            value={tagText}
            onChange={(value) => change(() => setTagText(value))}
            disabled={disabled}
            placeholder="family, planning"
          />
        </Section>
      )}
      {mode === "add" && (
        <Permissions
          value={permissions}
          change={(value) => change(() => setPermissions(value))}
          disabled={disabled}
        />
      )}
      {invalid && mode !== "supersede" && !tags.tags && (
        <MemoryText>Enter 1 to 8 tags, separated by commas.</MemoryText>
      )}
    </>,
    <FormSave disabled={disabled || !dirty || unchanged || choices.length > 0} onPress={submit} />,
  );
}

function claimInput(
  content: KnowledgeRecord["content"],
  permissions: PermissionDraft,
  { tags, changed }: ReturnType<typeof tagsDraft>,
  mutationKey: string,
  identity: { recordId: string; expectedRevision: number; mutationKey: string } | null,
  /** The person changed the claim itself. Evidence replaces a record's sources, so an edit
   * that leaves the claim as it was (tags only) sends none and keeps the original sources. */
  claimEdited: boolean,
) {
  const summary = memorySummary(content);
  const wording = `${summary.title}. ${summary.text}`;
  const evidence =
    wording.length <= 2048 && content.kind !== "inference"
      ? [{ type: "statement" as const, wording }]
      : [];
  return identity
    ? knowledgeLifecycleInputSchema.safeParse({
        ...identity,
        action: "revise",
        content,
        ...(claimEdited && evidence.length ? { evidence } : {}),
        ...(changed ? { tags } : {}),
      })
    : knowledgeMutationInputSchema.safeParse({
        mutationKey,
        content,
        scope: { workspace: permissions.workspace },
        tags,
        evidence,
        ...(permissions.purposes.length ? { purposes: permissions.purposes } : {}),
        sensitivity: permissions.sensitivity,
        core: permissions.core,
      });
}
