import type { KnowledgeRecord } from "@personal-os/domain";
import { Badge } from "@/components/ui/badge";
import { memoryOrigin, memoryStatus } from "./presentation";

/** Origin, status and access labels. No confidence score: origin and freshness say enough. */
export function MemoryBadges({ record }: { record: KnowledgeRecord }) {
  const status = memoryStatus(record);
  // Sensitive and hidden memory never loads at session start, whatever its core flag says.
  const loadsAtStart =
    record.core && record.sensitivity !== "sensitive" && record.agentAccess !== "blocked";
  return (
    <span className="flex min-w-0 flex-wrap gap-1">
      <Badge variant="secondary">{memoryOrigin(record)}</Badge>
      {record.sensitivity === "sensitive" ? <Badge variant="secondary">Sensitive</Badge> : null}
      {status ? <Badge variant="secondary">{status}</Badge> : null}
      {record.conflictRecordIds.length ? <Badge variant="secondary">Conflict</Badge> : null}
      {loadsAtStart ? <Badge variant="secondary">Core</Badge> : null}
      {record.agentAccess === "blocked" ? (
        <Badge variant="secondary">Hidden from agents</Badge>
      ) : null}
    </span>
  );
}

export function MemoryTags({ tags }: { tags: readonly string[] }) {
  return (
    <span className="flex min-w-0 flex-wrap gap-1">
      {tags.map((tag) => (
        <Badge key={tag} variant="outline">
          {tag}
        </Badge>
      ))}
    </span>
  );
}
