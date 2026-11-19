import {
  type KnowledgeRecord,
  knowledgeClaimKey,
  knowledgeContentSchema,
  knowledgePurposeSchema,
  knowledgeSummary,
  knowledgeWriteContentSchema,
} from "@personal-os/domain";

export type MemoryContent = KnowledgeRecord["content"];
export const memoryKinds = knowledgeContentSchema.options.map((schema) => schema.shape.kind.value);

export function memoryLabel(value: string) {
  return value.replace(/_/g, " ").replace(/^./, (character) => character.toUpperCase());
}

export function memoryContent(record: KnowledgeRecord): MemoryContent {
  // Agent-generated inferences carry a typed proposition. A standalone inference
  // keeps its own proposition, uncertainty and review condition.
  if (record.origin !== "inferred" || record.content.kind !== "inference" || !record.claimKey)
    return record.content;
  try {
    const parsed = knowledgeContentSchema.safeParse(JSON.parse(record.content.value.proposition));
    if (
      parsed.success &&
      knowledgeClaimKey(record.scope.workspace, parsed.data) === record.claimKey
    )
      return parsed.data;
  } catch {
    // Standalone propositions are ordinary text.
  }
  return record.content;
}

/** The shared readable title and text of a memory. */
export const memorySummary = knowledgeSummary;

export const originLabels = { stated: "Stated", inferred: "Inferred" } as const;

/** Origin, and Sensitive when set: the labels a row and the detail carry. No scores. */
export function memoryLabels(record: KnowledgeRecord) {
  return [
    originLabels[record.origin],
    ...(record.sensitivity === "sensitive" ? ["Sensitive"] : []),
  ];
}

const statusLabels: Partial<Record<KnowledgeRecord["status"], string>> = {
  proposed: "Agent’s proposal",
  disputed: "Disputed",
  archived: "Archived",
  superseded: "Replaced",
  expired: "Expired",
};
/** A record state worth naming; active memory names none. */
export function memoryStatus(record: KnowledgeRecord) {
  return record.trashedAt ? "In Trash" : statusLabels[record.status];
}

const day = 24 * 60 * 60 * 1000;
/** "today", "3 days ago", "a year ago": how long ago a time was, in whole days. */
export function memoryAge(at: string, now = Date.now()) {
  const days = Math.max(0, Math.floor((now - Date.parse(at)) / day));
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return months === 1 ? "a month ago" : `${months} months ago`;
  const years = Math.floor(days / 365);
  return years <= 1 ? "a year ago" : `${years} years ago`;
}

/**
 * When the memory was added and, if later, last confirmed. A record's `createdAt` is when it was
 * added and stays the same across revisions, so it never reads as an update time.
 */
export function memoryFreshness(record: KnowledgeRecord, now = Date.now()) {
  const added = `Added ${memoryAge(record.createdAt, now)}`;
  const confirmed = record.lastConfirmedAt;
  return confirmed && Date.parse(confirmed) > Date.parse(record.createdAt)
    ? `${added} · Confirmed ${memoryAge(confirmed, now)}`
    : added;
}

export function memoryDate(date: string) {
  return new Date(date).toLocaleDateString(undefined, { dateStyle: "medium" });
}

/** Memories this one names, other than itself: its related records and relationship ends. */
export function linkedMemoryIds(record: KnowledgeRecord) {
  const ids = [...record.relatedRecordIds];
  // An agent's inferred relationship carries its ends inside the inference.
  const content = memoryContent(record);
  if (content.kind === "relationship") ids.push(content.value.subjectId, content.value.objectId);
  return [...new Set(ids.map((id) => id.toLowerCase()))].filter(
    (id) => id !== record.id.toLowerCase(),
  );
}

export type Kind = MemoryContent["kind"];
type FieldSpec = { name: string; label: string; choices?: readonly string[]; multi?: boolean };
const subject = { name: "subject", label: "Subject" };
const dates = [
  { name: "validFrom", label: "Starts (ISO date and time)" },
  { name: "validUntil", label: "Ends (ISO date and time)" },
];
export const contentFields: Record<Kind, readonly FieldSpec[]> = {
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
export const valueTypes = ["string", "boolean", "integer", "date"] as const;

export function fieldDraft(content?: MemoryContent): Record<string, string> {
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

export function contentDraft(kind: Kind, draft: Record<string, string>, original?: MemoryContent) {
  const value: Record<string, unknown> = Object.fromEntries(
    contentFields[kind].map(({ name, choices }) => [name, draft[name] ?? choices?.[0] ?? ""]),
  );
  if (kind === "fact" || kind === "preference") {
    const type = draft.valueType ?? "string";
    const raw = draft.value ?? "";
    value.value = {
      type,
      value:
        type === "integer" && /^-?\d+$/.test(raw.trim())
          ? Number(raw)
          : type === "boolean"
            ? raw !== "false"
            : raw,
    };
  }
  if (kind === "decision" || kind === "inference")
    value.evidenceIds = original?.kind === kind ? original.value.evidenceIds : [];
  return knowledgeWriteContentSchema.safeParse({ kind, value });
}

/**
 * A field both the person and a newer revision changed, differently. `fields` holds the newer
 * revision's parts of it, which choosing that side sets together.
 */
export type DraftConflict = {
  field: string;
  label: string;
  mine: string;
  theirs: string;
  fields?: Record<string, string>;
};
type ClaimDraft = { kind: Kind; fields: Record<string, string> };
/** One editable field of a claim: its draft names, compared and chosen as a unit. */
type DraftField = { field: string; label: string; names: string[] };

/**
 * The fields a rebase compares. A typed value and its type are one field: taken apart, the
 * other side's type could reinterpret the person's value ("no" as the boolean true).
 */
function draftFields(kind: Kind): DraftField[] {
  return [
    ...contentFields[kind].map(({ name, label }) => ({ field: name, label, names: [name] })),
    ...(kind === "fact" || kind === "preference"
      ? [{ field: "value", label: "Value", names: ["valueType", "value"] }]
      : []),
  ];
}

function draftText({ field, names }: DraftField, fields: Record<string, string>) {
  if (field !== "value") return fields[names[0] ?? ""] ?? "";
  return `${fields.value ?? ""} (${memoryLabel(fields.valueType ?? "string")})`;
}

/** What a draft would save, in the person's terms, or a plain note when it is incomplete. */
function draftSummary(draft: ClaimDraft, base: MemoryContent) {
  const parsed = contentDraft(draft.kind, draft.fields, base);
  if (!parsed.success) return `Your edit (incomplete ${memoryLabel(draft.kind).toLowerCase()})`;
  const summary = memorySummary(parsed.data);
  return `${summary.title}: ${summary.text}`;
}

/**
 * Moves an editor's claim from the revision it started on (`base`) to a newer one (`theirs`).
 * A field the person left untouched takes the newer value; a field only the person changed
 * keeps theirs. A field both changed differently stays as the person has it and is returned as
 * a conflict to choose. A change of kind on either side compares the claim as a whole.
 */
export function rebaseClaim(
  base: MemoryContent,
  theirs: MemoryContent,
  mine: ClaimDraft,
): ClaimDraft & { conflicts: DraftConflict[] } {
  const was = fieldDraft(base);
  const now = fieldDraft(theirs);
  const pick = (names: string[], fields: Record<string, string>) =>
    names.map((name) => fields[name] ?? "");
  const same = (a: string[], b: string[]) => a.every((value, index) => value === b[index]);
  if (base.kind !== theirs.kind || mine.kind !== base.kind) {
    const mineChanged =
      mine.kind !== base.kind ||
      draftFields(base.kind).some(({ names }) => !same(pick(names, mine.fields), pick(names, was)));
    const theirsChanged = JSON.stringify(base) !== JSON.stringify(theirs);
    if (!mineChanged) return { kind: theirs.kind, fields: now, conflicts: [] };
    if (!theirsChanged) return { ...mine, conflicts: [] };
    const summary = memorySummary(theirs);
    return {
      ...mine,
      conflicts: [
        {
          field: "claim",
          label: "Memory",
          mine: draftSummary(mine, base),
          theirs: `${summary.title}: ${summary.text}`,
        },
      ],
    };
  }
  const fields = { ...mine.fields };
  const conflicts: DraftConflict[] = [];
  for (const field of draftFields(base.kind)) {
    const { names } = field;
    const before = pick(names, was);
    const after = pick(names, now);
    const current = pick(names, mine.fields);
    const newer = Object.fromEntries(names.map((name, index) => [name, after[index] ?? ""]));
    if (same(current, before)) Object.assign(fields, newer);
    else if (!same(after, before) && !same(after, current))
      conflicts.push({
        field: field.field,
        label: field.label,
        mine: draftText(field, mine.fields),
        theirs: draftText(field, now),
        fields: newer,
      });
  }
  return { kind: base.kind, fields, conflicts };
}
