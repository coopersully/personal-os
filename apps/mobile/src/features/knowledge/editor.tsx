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
import { FormSave } from "../../components/forms/form-save";
import { Field, Section, ToggleRow } from "../goals/controls";
import { MemoryChoice, MemoryText } from "./controls";
import {
  contentDraft,
  contentFields,
  fieldDraft,
  type Kind,
  memoryContent,
  memoryKinds,
  memoryLabel,
  memorySummary,
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
  const parsed = contentDraft(kind, draft, original);
  const tags = tagsDraft(tagText, record);
  const unchanged =
    mode === "edit" &&
    parsed.success &&
    JSON.stringify(parsed.data) === JSON.stringify(original) &&
    !tags.changed;

  function change(apply: () => void) {
    if (disabled) return;
    setDirty(true);
    onDirty();
    apply();
  }

  function submit() {
    if (disabled || !dirty || unchanged) return;
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
          ? claimInput(parsed.data, permissions, tags, mutationKey, identity)
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
    <FormSave disabled={disabled || !dirty || unchanged} onPress={submit} />,
  );
}

function claimInput(
  content: KnowledgeRecord["content"],
  permissions: PermissionDraft,
  { tags, changed }: ReturnType<typeof tagsDraft>,
  mutationKey: string,
  identity: { recordId: string; expectedRevision: number; mutationKey: string } | null,
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
        ...(evidence.length ? { evidence } : {}),
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
