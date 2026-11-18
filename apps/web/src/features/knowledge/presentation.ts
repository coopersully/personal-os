import {
  type KnowledgeRecord,
  knowledgeClaimKey,
  knowledgeContentSchema,
  knowledgePurposeSchema,
  knowledgeSummary,
  knowledgeTrashRetentionMs,
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

/** Origin never changes: a confirmed inference is still inferred. */
export function memoryOrigin(record: Pick<KnowledgeRecord, "origin">) {
  return record.origin === "stated" ? "Stated" : "Inferred";
}

/** Status as the person reads it; active memory needs no label. */
export function memoryStatus(record: Pick<KnowledgeRecord, "status">) {
  if (record.status === "active") return null;
  if (record.status === "proposed") return "Agent proposal";
  return memoryLabel(record.status);
}

export function memoryAuthor(record: Pick<KnowledgeRecord, "author">) {
  return record.author.actorType === "user" ? "You" : `Agent ${record.author.actorId}`;
}

export function memoryWorkspace(record: Pick<KnowledgeRecord, "scope">) {
  return record.scope.workspace ? memoryLabel(record.scope.workspace) : "All workspaces";
}

/** Purposes are a relevance hint; none, or every one, means every use. */
export function memoryUses(record: Pick<KnowledgeRecord, "purposes">) {
  if (!record.purposes.length || record.purposes.length === knowledgePurposeSchema.options.length)
    return "All uses";
  return record.purposes.map(memoryLabel).join(", ");
}

/** Restore and delete now act on the record whose Trash action moved the group. */
export function isTrashRoot(record: Pick<KnowledgeRecord, "id" | "trashGroupId" | "trashedAt">) {
  return record.trashedAt !== null && record.trashGroupId === record.id;
}

const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ["year", 365 * 24 * 60 * 60],
  ["month", 30 * 24 * 60 * 60],
  ["day", 24 * 60 * 60],
  ["hour", 60 * 60],
  ["minute", 60],
];

/** "3 days ago", or "just now" within the last minute. */
export function memoryAgo(value: string, at = Date.now()) {
  const seconds = Math.max(0, Math.round((at - Date.parse(value)) / 1000));
  const format = new Intl.RelativeTimeFormat("en", { numeric: "always" });
  for (const [unit, size] of units) {
    if (seconds >= size) return format.format(-Math.floor(seconds / size), unit);
  }
  return "just now";
}

/** When the memory last changed or the person last confirmed it. */
export function memoryFreshness(record: Pick<KnowledgeRecord, "createdAt" | "lastConfirmedAt">) {
  const latest =
    record.lastConfirmedAt && Date.parse(record.lastConfirmedAt) > Date.parse(record.createdAt)
      ? record.lastConfirmedAt
      : record.createdAt;
  return `Updated ${memoryAgo(latest)}`;
}

/** Days left before the purge job erases a trashed memory. */
export function memoryTrashDaysLeft(trashedAt: string, at = Date.now()) {
  const left = Date.parse(trashedAt) + knowledgeTrashRetentionMs - at;
  return Math.max(0, Math.ceil(left / (24 * 60 * 60 * 1000)));
}

export function memoryDate(value: string) {
  return new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}
