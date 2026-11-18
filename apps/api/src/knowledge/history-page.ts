import {
  type KnowledgePage,
  type KnowledgeRecord,
  type KnowledgeRecordReference,
  knowledgeRetrievalMaxRecords,
} from "@personal-os/domain";
import {
  type KnowledgeHistorySeek,
  nextKnowledgeHistoryRevision,
  ownedKnowledgeHistory,
  ownedKnowledgeHistoryRecordIds,
} from "./access.js";
import { type KnowledgeRetrievalSession, pageAvailability } from "./retrieval-session.js";

type RevisionProjection =
  | { state: "denied" | "unavailable" }
  | { state: "available"; record: KnowledgeRecord };

type HistoryRow = Awaited<ReturnType<typeof ownedKnowledgeHistory>>[number];
type ProjectHistoryRow = (row: HistoryRow) => Promise<RevisionProjection>;
const scanLimit = 2 * knowledgeRetrievalMaxRecords;

async function* exportRecordIds(
  { tx }: KnowledgeRetrievalSession,
  userId: string,
  startId: string | undefined,
) {
  let seek = startId ? { id: startId, inclusive: true } : null;
  const batchSize = knowledgeRetrievalMaxRecords + 1;
  for (;;) {
    const rows = await ownedKnowledgeHistoryRecordIds(tx, userId, seek, batchSize);
    for (const { id } of rows) yield id;
    const last = rows.at(-1);
    if (rows.length < batchSize || !last) return;
    seek = { id: last.id, inclusive: false };
  }
}

/**
 * A continuation starts at the next revision to read: the first verified one past a full page,
 * or the first unscanned one when the scan budget runs out. Every revision's disclosure is
 * checked again on the page that returns it, and only admitted records are ever named.
 */
export async function pageKnowledgeHistory(
  session: KnowledgeRetrievalSession,
  userId: string,
  recordId: string | undefined,
  admit: (recordId: string) => ProjectHistoryRow | null | Promise<ProjectHistoryRow | null>,
): Promise<KnowledgePage> {
  const cursor = session.historyCursor();
  const items: KnowledgeRecord[] = [];
  let unavailable = false;
  let remaining = scanLimit;

  function page(next?: KnowledgeRecordReference): KnowledgePage {
    return {
      schemaVersion: 1,
      items,
      epoch: session.epoch,
      state: pageAvailability(items, unavailable),
      nextCursor: next ? cursor.encode(next) : null,
    };
  }

  const ids = recordId ? [recordId] : exportRecordIds(session, userId, cursor.start?.recordId);
  for await (const id of ids) {
    // Live identity admission precedes any historical body reads or budget use.
    const project = await admit(id);
    if (!project) continue;

    let seek: KnowledgeHistorySeek | null =
      cursor.start?.recordId === id ? { revision: cursor.start.revision, inclusive: true } : null;
    while (remaining > 0) {
      const limit = Math.min(knowledgeRetrievalMaxRecords + 1, remaining);
      const rows = await ownedKnowledgeHistory(session.tx, userId, { recordId: id, seek, limit });
      remaining -= rows.length;
      for (const row of rows) {
        const projection = await project(row);
        if (projection.state === "available") {
          if (items.length === knowledgeRetrievalMaxRecords)
            return page({ recordId: id, revision: row.revision });
          items.push(projection.record);
        } else if (projection.state === "unavailable") {
          unavailable = true;
        }
      }
      const last = rows.at(-1);
      if (rows.length < limit || !last) break;
      seek = { revision: last.revision, inclusive: false };
    }
    if (remaining === 0) {
      // Out of budget: hand back what was found and continue past the scanned revisions, so
      // a long run of unreadable history never blocks the readable history after it.
      const next = await nextKnowledgeHistoryRevision(session.tx, userId, id, seek);
      if (next !== undefined) return page({ recordId: id, revision: next });
    }
  }
  return page();
}
