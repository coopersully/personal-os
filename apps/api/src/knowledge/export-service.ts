import {
  type KnowledgeExportInput,
  type KnowledgePage,
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
            const disclosure = await access.retrievalDisclosure(tx, principal, current);
            if (disclosure.state === "denied") return null;
            return (row) =>
              access.projectForRetrieval(tx, principal, projectKnowledgeRevision(row));
          });
        },
      );
    },
  };
}
