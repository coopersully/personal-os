import {
  type KnowledgePurpose,
  type KnowledgeWorkflowMemoryResult,
  knowledgeMemoryUnavailable,
} from "@personal-os/domain";
import { AppError } from "../errors.js";
import type { Principal, RequestLog } from "../types.js";
import type { createKnowledgeContextService } from "./context-service.js";

/** The purpose each maintenance workflow ranks first; other memory may still appear. */
const workflowPurposes = {
  finances: "bookkeeping",
  mail: "communication",
} as const satisfies Record<string, KnowledgePurpose>;

export type KnowledgeWorkflowWorkspace = keyof typeof workflowPurposes;
/** The request a section accompanies, as its failure log reports it. */
export type KnowledgeWorkflowRequest = Pick<RequestLog, "requestId" | "method" | "path" | "status">;
/**
 * Memory for a maintenance start: null when the caller cannot read memory, and the
 * `unavailable` marker when it could not be built.
 */
export type KnowledgeWorkflowMemory = (
  principal: Principal,
  workspace: KnowledgeWorkflowWorkspace,
  request: KnowledgeWorkflowRequest,
) => Promise<KnowledgeWorkflowMemoryResult>;

/**
 * Only the stack's frame lines. The whole message header is removed first: a parse error can
 * echo the memory value it rejected, a message may span several lines, and a message line can
 * itself look like a frame. When the stack does not start with that header, no stack is kept.
 */
function stackFrames(error: Error) {
  const { stack } = error;
  const header = error.message ? `${error.name}: ${error.message}` : error.name;
  if (!stack?.startsWith(header)) return undefined;
  const frames = stack
    .slice(header.length)
    .split("\n")
    .filter((line) => /^\s+at /u.test(line))
    .join("\n");
  return frames || undefined;
}

/** A failure's identity and location, never its message, which may carry memory content. */
export function knowledgeFailureFields(error: unknown) {
  if (!(error instanceof Error)) return { errorName: "NonError" };
  const errorStack = stackFrames(error);
  return {
    errorName: error.name,
    ...(error instanceof AppError ? { errorCode: error.code } : {}),
    ...(errorStack ? { errorStack } : {}),
  };
}

/**
 * Builds a workflow's memory section without ever failing the maintenance it accompanies. A
 * failure is logged and the section reads as `unavailable`, never as no memory access.
 */
export function createKnowledgeWorkflowMemory({
  context,
  log,
}: {
  context: Pick<ReturnType<typeof createKnowledgeContextService>, "workflowSection">;
  log: ((entry: RequestLog) => void) | undefined;
}): KnowledgeWorkflowMemory {
  return async (principal, workspace, request) => {
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
        ...knowledgeFailureFields(error),
        durationMs: Math.round((performance.now() - startedAt) * 100) / 100,
        ...request,
      });
      return knowledgeMemoryUnavailable;
    }
  };
}
