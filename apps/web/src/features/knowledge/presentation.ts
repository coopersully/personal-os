import {
  type KnowledgeRecord,
  knowledgeClaimKey,
  knowledgeContentSchema,
  knowledgeSummary,
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

export function memoryAcceptance(record: KnowledgeRecord) {
  if (record.acceptance?.kind === "owner") return "Accepted by you";
  return record.status === "proposed" ? "Awaiting review" : "Acceptance unrecorded";
}

export function memoryState(record: KnowledgeRecord) {
  if (record.status === "active") return "Accepted";
  return memoryLabel(record.status);
}
