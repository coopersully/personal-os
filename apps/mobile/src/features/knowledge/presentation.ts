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

/** The latest content change or confirmation. */
export function memoryUpdatedAt(record: KnowledgeRecord) {
  const created = Date.parse(record.createdAt);
  const confirmed = record.lastConfirmedAt ? Date.parse(record.lastConfirmedAt) : 0;
  return Math.max(created, confirmed);
}

const day = 24 * 60 * 60 * 1000;
export function memoryFreshness(record: KnowledgeRecord, now = Date.now()) {
  const days = Math.max(0, Math.floor((now - memoryUpdatedAt(record)) / day));
  if (days === 0) return "Updated today";
  if (days === 1) return "Updated yesterday";
  if (days < 30) return `Updated ${days} days ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return months === 1 ? "Updated a month ago" : `Updated ${months} months ago`;
  const years = Math.floor(days / 365);
  return years <= 1 ? "Updated a year ago" : `Updated ${years} years ago`;
}

export function memoryDate(date: string) {
  return new Date(date).toLocaleDateString(undefined, { dateStyle: "medium" });
}

/** Memories this one names, other than itself: its related records and relationship ends. */
export function linkedMemoryIds(record: KnowledgeRecord) {
  const ids = [...record.relatedRecordIds];
  if (record.content.kind === "relationship")
    ids.push(record.content.value.subjectId, record.content.value.objectId);
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
