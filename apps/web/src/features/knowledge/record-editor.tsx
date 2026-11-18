import {
  type KnowledgeLifecycleInput,
  type KnowledgeMutationInput,
  type KnowledgeRecord,
  knowledgeLifecycleInputSchema,
  knowledgeMutationInputSchema,
  knowledgePurposeSchema,
  knowledgeTagsInputSchema,
  knowledgeWorkspaceSchema,
  knowledgeWriteContentSchema,
} from "@personal-os/domain";
import { type FormEvent, type ReactNode, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import {
  type MemoryContent,
  memoryContent,
  memoryKinds,
  memoryLabel,
  memorySummary,
} from "./presentation";

type Kind = MemoryContent["kind"];
type FieldSpec = { name: string; label: string; choices?: readonly string[]; multi?: boolean };
const subject = { name: "subject", label: "Subject" };
const dates = [
  { name: "validFrom", label: "Starts (ISO date and time)" },
  { name: "validUntil", label: "Ends (ISO date and time)" },
];
const contentFields: Record<Kind, readonly FieldSpec[]> = {
  fact: [subject, { name: "predicate", label: "Fact" }],
  preference: [subject, { name: "key", label: "Preference" }],
  relationship: [
    { name: "subjectId", label: "First memory ID" },
    { name: "objectId", label: "Second memory ID" },
    { name: "relationship", label: "Relationship" },
    { name: "direction", label: "Direction", choices: ["directed", "bidirectional"] },
  ],
  goal: [{ name: "goalId", label: "Goal ID" }],
  constraint: [
    subject,
    { name: "condition", label: "Condition", multi: true },
    { name: "boundary", label: "Boundary", multi: true },
    ...dates,
  ],
  routine: [
    subject,
    { name: "recurrence", label: "Recurrence" },
    { name: "classification", label: "Origin", choices: ["stated", "observed"] },
    ...dates,
  ],
  decision: [
    subject,
    { name: "option", label: "Decision" },
    { name: "reason", label: "Reason", multi: true },
  ],
  entity_meaning: [
    { name: "recordId", label: "Memory ID" },
    { name: "meaning", label: "Meaning", multi: true },
    { name: "purpose", label: "Source purpose", choices: knowledgePurposeSchema.options },
  ],
  inference: [
    subject,
    { name: "proposition", label: "Proposition", multi: true },
    { name: "uncertainty", label: "Uncertainty", multi: true },
    { name: "reviewCondition", label: "Review condition", multi: true },
  ],
};
const valueTypes = ["string", "boolean", "integer", "date"] as const;

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
  return { parsed, changed };
}

function fieldDraft(content?: MemoryContent): Record<string, string> {
  if (!content) return { subject: "owner", valueType: "string" };
  const draft = Object.fromEntries(
    Object.entries(content.value).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
  if (content.kind === "fact" || content.kind === "preference") {
    draft.valueType = content.value.value.type;
    draft.value = String(content.value.value.value);
  }
  return draft;
}

export function memoryClaimFields(content: MemoryContent): Array<[string, string]> {
  const draft = fieldDraft(content);
  const fields: Array<[string, string]> = [
    ["Type", memoryLabel(content.kind)],
    ...contentFields[content.kind].map(({ name, label }): [string, string] => [
      label,
      draft[name] ?? "",
    ]),
  ];
  if (content.kind === "fact" || content.kind === "preference") {
    fields.push(
      ["Value type", memoryLabel(content.value.value.type)],
      ["Value", String(content.value.value.value)],
    );
  }
  if (
    (content.kind === "decision" || content.kind === "inference") &&
    content.value.evidenceIds.length
  ) {
    fields.push(["Evidence IDs", content.value.evidenceIds.join(", ")]);
  }
  return fields;
}

function contentDraft(kind: Kind, draft: Record<string, string>, original?: MemoryContent) {
  const value: Record<string, unknown> = Object.fromEntries(
    contentFields[kind].map(({ name, choices }) => [name, draft[name] ?? choices?.[0] ?? ""]),
  );
  if (kind === "fact" || kind === "preference") {
    const type = draft.valueType ?? "string";
    const raw = draft.value ?? "";
    value.value = {
      type,
      value:
        type === "integer" && raw.trim() ? Number(raw) : type === "boolean" ? raw !== "false" : raw,
    };
  }
  if (kind === "decision" || kind === "inference")
    value.evidenceIds = original?.kind === kind ? original.value.evidenceIds : [];
  return knowledgeWriteContentSchema.safeParse({ kind, value });
}

function PurposeFields({
  selected,
  change,
  disabled,
}: {
  selected: KnowledgeRecord["purposes"];
  change: (next: KnowledgeRecord["purposes"]) => void;
  disabled: boolean;
}) {
  const id = useId();
  return (
    <FieldSet>
      <FieldLegend>Uses</FieldLegend>
      <FieldDescription>Leave these empty to use this memory everywhere.</FieldDescription>
      <FieldGroup className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,8rem),1fr))] gap-2">
        {knowledgePurposeSchema.options.map((purpose) => (
          <Field key={purpose} orientation="horizontal">
            <Checkbox
              id={`${id}-${purpose}`}
              checked={selected.includes(purpose)}
              disabled={disabled}
              onCheckedChange={(checked) =>
                change(
                  checked ? [...selected, purpose] : selected.filter((entry) => entry !== purpose),
                )
              }
            />
            <FieldLabel htmlFor={`${id}-${purpose}`}>{memoryLabel(purpose)}</FieldLabel>
          </Field>
        ))}
      </FieldGroup>
    </FieldSet>
  );
}

function MemorySelect({
  id,
  value,
  choices,
  change,
  disabled,
  label,
}: {
  id: string;
  value: string;
  choices: readonly string[];
  change: (value: string) => void;
  disabled: boolean;
  label?: (value: string) => string;
}) {
  return (
    <NativeSelect
      id={id}
      value={value}
      onChange={(event) => change(event.target.value)}
      disabled={disabled}
      className="w-full"
    >
      {choices.map((choice) => (
        <NativeSelectOption key={choice} value={choice}>
          {(label ?? memoryLabel)(choice)}
        </NativeSelectOption>
      ))}
    </NativeSelect>
  );
}

/**
 * The person may set any workspace. Narrowing from every workspace is a `restrict`, which agents
 * may also do; anything else is the person-only `widen`.
 */
export function MemoryWorkspace({
  record,
  disabled,
  onSave,
  onInvalid,
  footer,
}: {
  record: KnowledgeRecord;
  disabled: boolean;
  onSave: (input: KnowledgeLifecycleInput) => void;
  onInvalid: () => void;
  footer: ReactNode;
}) {
  const id = useId();
  const [workspace, setWorkspace] = useState<string>(record.scope.workspace ?? "");
  const unchanged = workspace === (record.scope.workspace ?? "");

  function submit(event: FormEvent) {
    event.preventDefault();
    if (disabled || unchanged) return;
    const parsed = knowledgeLifecycleInputSchema.safeParse({
      action: record.scope.workspace === null ? "restrict" : "widen",
      recordId: record.id,
      expectedRevision: record.revision,
      mutationKey: crypto.randomUUID(),
      workspace: workspace || null,
    });
    if (!parsed.success) {
      onInvalid();
      return;
    }
    onSave(parsed.data);
  }

  return (
    <form onSubmit={submit} className="flex min-w-0 flex-col gap-4">
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor={`${id}-workspace`}>Workspace</FieldLabel>
          <MemorySelect
            id={`${id}-workspace`}
            value={workspace}
            change={setWorkspace}
            choices={["", ...knowledgeWorkspaceSchema.options]}
            label={(entry) => (entry ? memoryLabel(entry) : "All workspaces")}
            disabled={disabled}
          />
        </Field>
      </FieldGroup>
      <div className="grid gap-2 sm:grid-cols-2">
        {footer}
        <Button type="submit" disabled={disabled || unchanged}>
          Save workspace
        </Button>
      </div>
    </form>
  );
}

export function RecordEditor({
  record,
  initialContent,
  disabled,
  onSave,
  onInvalid,
  footer,
}: {
  record?: KnowledgeRecord;
  /** Content to start the draft from instead of the record's, such as an agent's proposal. */
  initialContent?: MemoryContent | undefined;
  disabled: boolean;
  onSave: (input: KnowledgeMutationInput | KnowledgeLifecycleInput) => void;
  onInvalid: () => void;
  footer: ReactNode;
}) {
  const id = useId();
  const original = record ? memoryContent(record) : undefined;
  const start = initialContent ?? original;
  const [kind, setKind] = useState<Kind>(start?.kind ?? "fact");
  const [draft, setDraft] = useState(() => fieldDraft(start));
  const [workspace, setWorkspace] = useState(record?.scope.workspace ?? "");
  const [purposes, setPurposes] = useState<KnowledgeRecord["purposes"]>([]);
  const [sensitive, setSensitive] = useState(false);
  const [core, setCore] = useState(false);
  const [tagText, setTagText] = useState(record?.tags.join(", ") ?? "");
  const [errors, setErrors] = useState<Record<string, string>>({});

  const change = (key: string, value: string) =>
    setDraft((previous) => ({ ...previous, [key]: value }));

  const parsed = contentDraft(kind, draft, original);
  const tags = tagsDraft(tagText, record);
  const unchanged = Boolean(
    record &&
      parsed.success &&
      JSON.stringify(parsed.data) === JSON.stringify(original) &&
      !tags.changed,
  );

  function submit(event: FormEvent) {
    event.preventDefault();
    if (disabled || unchanged) return;
    if (!parsed.success) {
      setErrors(
        Object.fromEntries(
          parsed.error.issues.map((issue) => [
            issue.path[1] ?? "content",
            issue.path[1] ? "Enter a valid value." : "Reduce the size of this memory.",
          ]),
        ),
      );
      onInvalid();
      return;
    }
    if (!tags.parsed.success) {
      setErrors({ tags: "Enter 1 to 8 tags, separated by commas." });
      onInvalid();
      return;
    }
    const content = parsed.data;
    const summary = memorySummary(content);
    const wording = `${summary.title}. ${summary.text}`;
    const evidence =
      wording.length <= 2048 && content.kind !== "inference"
        ? [{ type: "statement" as const, wording }]
        : [];
    const mutationKey = crypto.randomUUID();
    const input = record
      ? knowledgeLifecycleInputSchema.safeParse({
          action: "revise",
          recordId: record.id,
          expectedRevision: record.revision,
          mutationKey,
          content,
          ...(JSON.stringify(content) !== JSON.stringify(original) && evidence.length
            ? { evidence }
            : {}),
          ...(tags.changed ? { tags: tags.parsed.data } : {}),
        })
      : knowledgeMutationInputSchema.safeParse({
          mutationKey,
          content,
          evidence,
          scope: { workspace: workspace || null },
          tags: tags.parsed.data,
          ...(purposes.length ? { purposes } : {}),
          core,
          sensitivity: sensitive ? "sensitive" : "standard",
        });
    if (!input.success) {
      onInvalid();
      return;
    }
    setErrors({});
    onSave(input.data);
  }

  const typed = kind === "fact" || kind === "preference";
  return (
    <form onSubmit={submit} noValidate className="flex min-w-0 flex-col gap-4">
      <FieldGroup>
        <Field data-invalid={Boolean(errors.content)}>
          <FieldLabel htmlFor={`${id}-type`}>Memory type</FieldLabel>
          <MemorySelect
            id={`${id}-type`}
            value={kind}
            choices={memoryKinds}
            disabled={disabled}
            change={(entry) => {
              setKind(entry as Kind);
              setDraft(fieldDraft());
              setErrors({});
            }}
          />
          {errors.content ? <FieldError>{errors.content}</FieldError> : null}
        </Field>
        {contentFields[kind].map(({ name, label, choices, multi }) => {
          const inputId = `${id}-${name}`;
          const InputControl = multi ? Textarea : Input;
          return (
            <Field key={name} data-invalid={Boolean(errors[name])}>
              <FieldLabel htmlFor={inputId}>{label}</FieldLabel>
              {choices ? (
                <MemorySelect
                  id={inputId}
                  value={draft[name] ?? choices[0] ?? ""}
                  choices={choices}
                  change={(value) => change(name, value)}
                  disabled={disabled}
                />
              ) : (
                <InputControl
                  id={inputId}
                  value={draft[name] ?? ""}
                  disabled={disabled}
                  aria-invalid={Boolean(errors[name])}
                  aria-describedby={errors[name] ? `${inputId}-error` : undefined}
                  onChange={(event) => change(name, event.target.value)}
                />
              )}
              {errors[name] ? (
                <FieldError id={`${inputId}-error`}>{errors[name]}</FieldError>
              ) : null}
            </Field>
          );
        })}
        {typed ? (
          <>
            <Field>
              <FieldLabel htmlFor={`${id}-value-type`}>Value type</FieldLabel>
              <MemorySelect
                id={`${id}-value-type`}
                value={draft.valueType ?? "string"}
                choices={valueTypes}
                disabled={disabled}
                label={(entry) =>
                  ({ string: "Text", boolean: "Yes or no", integer: "Whole number", date: "Date" })[
                    entry
                  ] ?? entry
                }
                change={(value) => {
                  change("valueType", value);
                  change("value", "");
                }}
              />
            </Field>
            <Field data-invalid={Boolean(errors.value)}>
              <FieldLabel htmlFor={`${id}-value`}>Value</FieldLabel>
              {draft.valueType === "boolean" ? (
                <MemorySelect
                  id={`${id}-value`}
                  value={draft.value || "true"}
                  choices={["true", "false"]}
                  label={(entry) => (entry === "true" ? "Yes" : "No")}
                  change={(value) => change("value", value)}
                  disabled={disabled}
                />
              ) : (
                <Input
                  id={`${id}-value`}
                  value={draft.value ?? ""}
                  disabled={disabled}
                  type={draft.valueType === "date" ? "date" : "text"}
                  inputMode={draft.valueType === "integer" ? "numeric" : undefined}
                  aria-invalid={Boolean(errors.value)}
                  aria-describedby={errors.value ? `${id}-value-error` : undefined}
                  onChange={(event) => change("value", event.target.value)}
                />
              )}
              {errors.value ? (
                <FieldError id={`${id}-value-error`}>{errors.value}</FieldError>
              ) : null}
            </Field>
          </>
        ) : null}
        <Field data-invalid={Boolean(errors.tags)}>
          <FieldLabel htmlFor={`${id}-tags`}>Tags</FieldLabel>
          <Input
            id={`${id}-tags`}
            value={tagText}
            disabled={disabled}
            placeholder="family, planning"
            aria-invalid={Boolean(errors.tags)}
            aria-describedby={errors.tags ? `${id}-tags-error` : undefined}
            onChange={(event) => setTagText(event.target.value)}
          />
          {errors.tags ? <FieldError id={`${id}-tags-error`}>{errors.tags}</FieldError> : null}
        </Field>
        {!record ? (
          <>
            <Field>
              <FieldLabel htmlFor={`${id}-workspace`}>Workspace</FieldLabel>
              <MemorySelect
                id={`${id}-workspace`}
                value={workspace}
                choices={["", ...knowledgeWorkspaceSchema.options]}
                disabled={disabled}
                label={(entry) => (entry ? memoryLabel(entry) : "All workspaces")}
                change={setWorkspace}
              />
            </Field>
            <PurposeFields selected={purposes} change={setPurposes} disabled={disabled} />
            <Field orientation="horizontal">
              <Checkbox
                id={`${id}-core`}
                checked={core}
                disabled={disabled}
                onCheckedChange={(value) => setCore(value === true)}
              />
              <FieldLabel htmlFor={`${id}-core`}>Load at session start</FieldLabel>
            </Field>
            <Field orientation="horizontal">
              <Checkbox
                id={`${id}-private`}
                checked={sensitive}
                disabled={disabled}
                onCheckedChange={(value) => setSensitive(value === true)}
              />
              <FieldLabel htmlFor={`${id}-private`}>Sensitive</FieldLabel>
            </Field>
          </>
        ) : null}
      </FieldGroup>
      <div className="grid gap-2 sm:grid-cols-2">
        {footer}
        <Button type="submit" disabled={disabled || unchanged}>
          Save memory
        </Button>
      </div>
    </form>
  );
}
