import {
  type KnowledgeExportInput,
  type KnowledgePage,
  type KnowledgeRecord,
  knowledgeExportInputSchema,
} from "@personal-os/domain";
import type { Principal } from "../types.js";
import { findOwnedKnowledgeRevision, projectKnowledgeRevision } from "./access.js";
import { pageKnowledgeHistory } from "./history-page.js";
import {
  createKnowledgeRetrievalSession,
  type KnowledgeRetrievalDependencies,
} from "./retrieval-session.js";

export function createKnowledgeExportService(dependencies: KnowledgeRetrievalDependencies) {
  const run = createKnowledgeRetrievalSession(dependencies);
  return {
    async exportPage(principal: Principal, raw: KnowledgeExportInput): Promise<KnowledgePage> {
      const input = knowledgeExportInputSchema.parse(raw);
      return run(
        principal,
        { operation: "export", ownerOnly: true, cursor: input.cursor },
        async (session) => {
          const { tx, access } = session;
          return pageKnowledgeHistory(session, principal.userId, undefined, async (recordId) => {
            const current = await findOwnedKnowledgeRevision(tx, principal.userId, recordId);
            if (!current) return null;
            const allowed: KnowledgeRecord["purposes"] = [];
            for (const purpose of current.snapshot.purposes) {
              const disclosure = await access.retrievalDisclosure(tx, principal, current, purpose);
              if (disclosure.state !== "denied") allowed.push(purpose);
            }
            if (!allowed.length) return null;

            return async (row) => {
              const revision = projectKnowledgeRevision(row);
              let missingSource = false;
              for (const purpose of allowed) {
                if (!revision.snapshot.purposes.includes(purpose)) continue;
                const projection = await access.projectForRetrieval(
                  tx,
                  principal,
                  revision,
                  purpose,
                );
                if (projection.state === "available") return projection;
                if (projection.state === "unavailable") missingSource = true;
              }
              return { state: missingSource ? "unavailable" : "denied" };
            };
          });
        },
      );
    },
  };
}
