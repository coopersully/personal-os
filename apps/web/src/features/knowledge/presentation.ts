import {
  type KnowledgeRecord,
  knowledgeClaimKey,
  knowledgeContentSchema,
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
  if (record.status === "active") return record.stale ? "Review due" : "Accepted";
  return memoryLabel(record.status);
}
