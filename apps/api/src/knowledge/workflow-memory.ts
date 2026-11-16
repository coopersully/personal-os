import type { KnowledgeContextPack, KnowledgePurpose } from "@personal-os/domain";
import { AppError } from "../errors.js";
import type { Principal, RequestLog } from "../types.js";
import type { createKnowledgeContextService } from "./context-service.js";

/** The purpose each maintenance workflow ranks first; other memory may still appear. */
const workflowPurposes = {
  finances: "bookkeeping",
  mail: "communication",
} as const satisfies Record<string, KnowledgePurpose>;

export type KnowledgeWorkflowWorkspace = keyof typeof workflowPurposes;
/** Memory for a maintenance start, or null when the caller cannot read it or it failed. */
export type KnowledgeWorkflowMemory = (
  principal: Principal,
  workspace: KnowledgeWorkflowWorkspace,
  requestId: string,
) => Promise<KnowledgeContextPack | null>;

/**
 * Only the stack's frame lines. Every message line is dropped: a parse error can echo the memory
 * value it rejected, and a message may span several lines.
 */
function stackFrames(stack: string | undefined) {
  const frames = stack
    ?.split("\n")
    .filter((line) => /^\s+at /u.test(line))
    .join("\n");
  return frames || undefined;
}

/** A failure's identity and location, never its message, which may carry memory content. */
function failureFields(error: unknown) {
  if (!(error instanceof Error)) return { errorName: "NonError" };
  const errorStack = stackFrames(error.stack);
  return {
    errorName: error.name,
    ...(error instanceof AppError ? { errorCode: error.code } : {}),
    ...(errorStack ? { errorStack } : {}),
  };
}

/**
 * Builds a workflow's memory section without ever failing the maintenance it accompanies. A
 * failure is logged and the section reads as null.
 */
export function createKnowledgeWorkflowMemory({
  context,
  log,
}: {
  context: Pick<ReturnType<typeof createKnowledgeContextService>, "workflowSection">;
  log: ((entry: RequestLog) => void) | undefined;
}): KnowledgeWorkflowMemory {
  return async (principal, workspace, requestId) => {
    const startedAt = performance.now();
    try {
      return await context.workflowSection(principal, {
        workspace,
        purpose: workflowPurposes[workspace],
      });
    } catch (error) {
      log?.({
        event: "knowledge_workflow_memory_failed",
        workspace,
        ...failureFields(error),
        durationMs: Math.round((performance.now() - startedAt) * 100) / 100,
        method: "POST",
        path: `/v1/${workspace}/maintenance`,
        requestId,
        status: 200,
      });
      return null;
    }
  };
}
