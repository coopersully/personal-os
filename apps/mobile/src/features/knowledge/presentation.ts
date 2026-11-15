import {
  type KnowledgeRecord,
  knowledgeClaimKey,
  knowledgeContentSchema,
  knowledgePurposeSchema,
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

export function memorySummary(content: MemoryContent): { title: string; text: string } {
  switch (content.kind) {
    case "fact":
      return {
        title:
          content.value.subject === "owner"
            ? memoryLabel(content.value.predicate)
            : `${content.value.subject} · ${content.value.predicate}`,
        text: String(content.value.value.value),
      };
    case "preference": {
      const { subject, key, value } = content.value;
      const label = memoryLabel(key);
      return {
        title: subject === "owner" ? label : `${subject} · ${label}`,
        text: String(value.value),
      };
    }
    case "relationship":
      return {
        title: content.value.relationship,
        text: `${content.value.subjectId} ${content.value.direction === "directed" ? "→" : "↔"} ${content.value.objectId}`,
      };
    case "goal":
      return { title: "Linked goal", text: content.value.goalId };
    case "constraint":
      return {
        title: content.value.subject,
        text: `${content.value.condition} · ${content.value.boundary}`,
      };
    case "routine":
      return { title: content.value.subject, text: content.value.recurrence };
    case "decision":
      return {
        title: content.value.subject,
        text: `${content.value.option} · ${content.value.reason}`,
      };
    case "entity_meaning":
      return { title: "Record meaning", text: content.value.meaning };
    case "inference":
      return { title: content.value.subject, text: content.value.proposition };
  }
}

export function memoryAcceptance(record: KnowledgeRecord) {
  if (record.acceptance?.kind === "owner") return "Accepted by you";
  return record.status === "proposed" ? "Awaiting review" : "Acceptance unrecorded";
}

export function memoryState(record: KnowledgeRecord) {
  if (record.status === "active") return "Accepted";
  return memoryLabel(record.status);
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
