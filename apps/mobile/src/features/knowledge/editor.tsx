import {
  type KnowledgeLifecycleInput,
  type KnowledgeMutationInput,
  type KnowledgeRecord,
  knowledgeLifecycleInputSchema,
  knowledgeMutationInputSchema,
  knowledgePurposeSchema,
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
export type EditMode = "edit" | "restrict" | "supersede";
const visibilityLabels = { standard: "Standard", sensitive: "Sensitive" };

type PermissionDraft = {
  workspace: Scope;
  purposes: Purpose[];
  sensitivity: Sensitivity;
};
export function permissionDraft(
  record?: KnowledgeRecord,
  purpose: Purpose = "planning",
): PermissionDraft {
  return {
    workspace: record?.scope.workspace ?? null,
    purposes: record?.purposes ?? [purpose],
    sensitivity: record?.sensitivity ?? "standard",
  };
}

function Permissions({
  value,
  record,
  change,
  disabled,
  workspaceOnly = false,
}: {
  value: PermissionDraft;
  record?: KnowledgeRecord;
  change: (value: PermissionDraft) => void;
  disabled: boolean;
  /** Restricting only narrows the workspace, so it offers nothing else. */
  workspaceOnly?: boolean;
}) {
  return (
    <>
      <Section title="Access">
        <MemoryChoice
          label="Workspace"
          value={value.workspace ?? ""}
          choices={
            record?.scope.workspace
              ? [record.scope.workspace]
              : ["", ...knowledgeWorkspaceSchema.options]
          }
          labels={{ "": "All workspaces" }}
          onChange={(workspace) => change({ ...value, workspace: workspace || null })}
          disabled={disabled || Boolean(record?.scope.workspace)}
        />
        {workspaceOnly ? null : (
          <MemoryChoice
            label="Sensitivity"
            value={value.sensitivity}
            choices={["standard", "sensitive"]}
            labels={visibilityLabels}
            onChange={(sensitivity) => change({ ...value, sensitivity })}
            disabled={disabled}
          />
        )}
      </Section>
      {workspaceOnly ? null : (
        <Section title="Allowed uses">
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
      )}
    </>
  );
}

export function MemoryEditor({
  mode,
  record,
  purpose,
  disabled,
  onDirty,
  onSave,
  onInvalid,
  layout,
}: {
  mode: "add" | EditMode;
  record?: KnowledgeRecord;
  purpose: Purpose;
  disabled: boolean;
  onDirty: () => void;
  onSave: (input: KnowledgeLifecycleInput | KnowledgeMutationInput) => void;
  onInvalid: () => void;
  layout: (fields: React.ReactNode, save: React.ReactNode) => React.ReactNode;
}) {
  const original = record && memoryContent(record);
  const [kind, setKind] = useState<Kind>(original?.kind ?? "fact");
  const [draft, setDraft] = useState(() => fieldDraft(original));
  const [permissions, setPermissions] = useState(() => permissionDraft(record, purpose));
  const [replacementId, setReplacementId] = useState("");
  const [dirty, setDirty] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const parsed = contentDraft(kind, draft, original);
  // Restricting only narrows the workspace of the just-reviewed revision.
  const restricted = {
    ...permissions,
    workspace: record?.scope.workspace ?? permissions.workspace,
  };
  const unchanged =
    mode === "edit"
      ? parsed.success && JSON.stringify(parsed.data) === JSON.stringify(original)
      : mode === "restrict"
        ? restricted.workspace === (record?.scope.workspace ?? null)
        : false;

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
        : mode === "restrict"
          ? knowledgeLifecycleInputSchema.safeParse({
              ...identity,
              action: "restrict",
              workspace: restricted.workspace,
            })
          : parsed.success
            ? claimInput(parsed.data, permissions, mutationKey, identity)
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
        mode !== "restrict" && (
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
          </Section>
        )
      )}
      {(mode === "add" || mode === "restrict") && (
        <Permissions
          record={mode === "restrict" ? record : undefined}
          value={mode === "restrict" ? restricted : permissions}
          change={(value) => change(() => setPermissions(value))}
          disabled={disabled}
          workspaceOnly={mode === "restrict"}
        />
      )}
      {invalid && mode === "add" && !permissions.purposes.length && (
        <MemoryText>Select at least one allowed use.</MemoryText>
      )}
    </>,
    <FormSave disabled={disabled || !dirty || unchanged} onPress={submit} />,
  );
}

function claimInput(
  content: KnowledgeRecord["content"],
  permissions: PermissionDraft,
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
      })
    : knowledgeMutationInputSchema.safeParse({
        mutationKey,
        content,
        scope: { workspace: permissions.workspace },
        evidence,
        purposes: permissions.purposes,
        sensitivity: permissions.sensitivity,
      });
}
