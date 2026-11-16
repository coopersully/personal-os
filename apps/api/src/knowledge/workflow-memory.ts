import type { KnowledgeContextPack, KnowledgePurpose } from "@personal-os/domain";
import type { Principal } from "../types.js";
import type { createKnowledgeContextService } from "./context-service.js";

/** The purpose each maintenance workflow ranks first; other memory may still appear. */
const workflowPurposes = {
  finances: "bookkeeping",
  mail: "communication",
} as const satisfies Record<string, KnowledgePurpose>;

export type KnowledgeWorkflowWorkspace = keyof typeof workflowPurposes;
export type KnowledgeWorkflowMemoryFailure = {
  workspace: KnowledgeWorkflowWorkspace;
  requestId: string;
  durationMs: number;
  message: string;
  stack: string | undefined;
};
/** Memory for a maintenance start, or null when the caller cannot read it or it failed. */
export type KnowledgeWorkflowMemory = (
  principal: Principal,
  workspace: KnowledgeWorkflowWorkspace,
  requestId: string,
) => Promise<KnowledgeContextPack | null>;

/**
 * Builds a workflow's memory section without ever failing the maintenance it accompanies. A
 * failure is reported to `onFailure` and the section reads as null.
 */
export function createKnowledgeWorkflowMemory({
  context,
  onFailure,
}: {
  context: Pick<ReturnType<typeof createKnowledgeContextService>, "workflowSection">;
  onFailure: (failure: KnowledgeWorkflowMemoryFailure) => void;
}): KnowledgeWorkflowMemory {
  return async (principal, workspace, requestId) => {
    const startedAt = performance.now();
    try {
      return await context.workflowSection(principal, {
        workspace,
        purpose: workflowPurposes[workspace],
      });
    } catch (error) {
      onFailure({
        workspace,
        requestId,
        durationMs: Math.round((performance.now() - startedAt) * 100) / 100,
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      return null;
    }
  };
}
