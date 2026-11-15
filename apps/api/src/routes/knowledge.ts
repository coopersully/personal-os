import {
  activeKnowledgeForgetOperationsSchema,
  knowledgeContextExplanationSchema,
  knowledgeContextPackSchema,
  knowledgeExplainInputSchema,
  knowledgeExportInputSchema,
  knowledgeForgetInputSchema,
  knowledgeForgetOperationInputSchema,
  knowledgeForgetPreviewInputSchema,
  knowledgeForgetPreviewSchema,
  knowledgeForgetStatusSchema,
  knowledgeHistoryInputSchema,
  knowledgeLifecycleInputSchema,
  knowledgeMutationInputSchema,
  knowledgeMutationResultSchema,
  knowledgePageSchema,
  knowledgeQuerySchema,
  knowledgeReadInputSchema,
  knowledgeReadResultSchema,
  knowledgeSaveResultSchema,
  knowledgeSelectionInputSchema,
  knowledgeSelectionInteractionSchema,
  knowledgeSelectionResultSchema,
  knowledgeSettingsInputSchema,
  knowledgeSettingsSchema,
  knowledgeSuppressionResetInputSchema,
  knowledgeSuppressionResetResultSchema,
} from "@personal-os/domain";
import type { Context, Hono } from "hono";
import { z } from "zod";
import { AppError } from "../errors.js";
import type { createKnowledgeContextService } from "../knowledge/context-service.js";
import type { createKnowledgeExportService } from "../knowledge/export-service.js";
import type { createKnowledgeForgetService } from "../knowledge/forget-service.js";
import type { createKnowledgeLearningService } from "../knowledge/learning-service.js";
import type { createKnowledgeLifecycleService } from "../knowledge/lifecycle-service.js";
import type { createKnowledgeRecordService } from "../knowledge/record-service.js";
import type { createKnowledgeSearchService } from "../knowledge/search-service.js";
import type { AppEnv } from "../types.js";
import { parseBody, parseOptionalBody, requireHuman } from "./support.js";

const empty = z.strictObject({});
const object = z.record(z.string(), z.unknown());
const knowledgeSearchQuerySchema = knowledgeQuerySchema.omit({ timeWindow: true }).extend({
  from: z.string().optional(),
  to: z.string().optional(),
  limit: z
    .string()
    .regex(/^\d{1,2}$/)
    .transform(Number)
    .optional(),
  hasConflict: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .optional(),
});

function queryParameters(context: Context, repeated?: string) {
  return Object.fromEntries(
    Object.entries(context.req.queries()).map(([key, values]) => [
      key,
      key === repeated || values.length > 1 ? values : values[0],
    ]),
  );
}

function pathInput(input: Record<string, unknown>, key: string, value: string) {
  if (Object.hasOwn(input, key))
    throw new AppError("invalid_request", "The record or operation ID must come from the path.");
  return { ...input, [key]: value };
}

function parseKnowledgeResponse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new AppError("internal_error", "An unexpected error occurred.");
  return result.data;
}

/** Knowledge owns authorization, provenance and persistence. Routes adapt HTTP to typed intent. */
export function registerKnowledgeRoutes({
  app,
  knowledge,
  lifecycle,
  forget,
  forgettingConfigured,
  learning,
  search,
  context: contextService,
  export: exportService,
}: {
  app: Hono<AppEnv>;
  knowledge: ReturnType<typeof createKnowledgeRecordService>;
  lifecycle: ReturnType<typeof createKnowledgeLifecycleService>;
  forget: ReturnType<typeof createKnowledgeForgetService>;
  forgettingConfigured: boolean;
  learning: ReturnType<typeof createKnowledgeLearningService>;
  search: ReturnType<typeof createKnowledgeSearchService>;
  context: ReturnType<typeof createKnowledgeContextService>;
  export: ReturnType<typeof createKnowledgeExportService>;
}) {
  app.post("/v1/knowledge", async (context) => {
    const result = await knowledge.create(
      context.get("principal"),
      await parseBody(context, knowledgeMutationInputSchema),
    );
    // V1 consumers must branch on outcome before reading any record fields.
    context.header("X-Knowledge-Receipt-Version", "1");
    return context.json(parseKnowledgeResponse(knowledgeSaveResultSchema, result), 201);
  });
  app.get("/v1/knowledge", async (context) => {
    const { from, to, ...query } = knowledgeSearchQuerySchema.parse(
      queryParameters(context, "entityRefs"),
    );
    const input = knowledgeQuerySchema.parse({
      ...query,
      ...(from !== undefined || to !== undefined ? { timeWindow: { from, to } } : {}),
    });
    return context.json(
      parseKnowledgeResponse(
        knowledgePageSchema,
        await search.search(context.get("principal"), input),
      ),
    );
  });
  app.post("/v1/knowledge/search", async (context) => {
    const input = await parseBody(context, knowledgeQuerySchema);
    return context.json(
      parseKnowledgeResponse(
        knowledgePageSchema,
        await search.search(context.get("principal"), input),
      ),
    );
  });
  app.post("/v1/knowledge/context", async (context) => {
    const input = await parseBody(context, knowledgeQuerySchema);
    return context.json(
      parseKnowledgeResponse(
        knowledgeContextPackSchema,
        await contextService.context(context.get("principal"), input),
      ),
    );
  });
  app.get("/v1/knowledge/context/:id", async (context) => {
    const input = knowledgeExplainInputSchema.parse(
      pathInput(queryParameters(context), "contextUseId", context.req.param("id")),
    );
    return context.json(
      parseKnowledgeResponse(
        knowledgeContextExplanationSchema,
        await contextService.explain(context.get("principal"), input),
      ),
    );
  });
  app.get("/v1/knowledge/export", async (context) => {
    const input = knowledgeExportInputSchema.parse(queryParameters(context));
    return context.json(
      parseKnowledgeResponse(
        knowledgePageSchema,
        await exportService.exportPage(context.get("principal"), input),
      ),
    );
  });
  app.get("/v1/knowledge/settings", async (context) => {
    empty.parse(queryParameters(context));
    return context.json(
      parseKnowledgeResponse(
        knowledgeSettingsSchema,
        await learning.getSettings(context.get("principal")),
      ),
    );
  });
  app.patch("/v1/knowledge/settings", async (context) => {
    const input = await parseBody(context, knowledgeSettingsInputSchema);
    return context.json(
      parseKnowledgeResponse(
        knowledgeSettingsSchema,
        await learning.updateSettings(context.get("principal"), input),
      ),
    );
  });
  app.post("/v1/knowledge/selection-interactions", async (context) => {
    await parseOptionalBody(context, empty);
    return context.json(
      parseKnowledgeResponse(
        knowledgeSelectionInteractionSchema,
        await learning.issueSelectionInteraction(context.get("principal")),
      ),
      201,
    );
  });
  app.post("/v1/knowledge/selections", async (context) => {
    const input = await parseBody(context, knowledgeSelectionInputSchema);
    return context.json(
      parseKnowledgeResponse(
        knowledgeSelectionResultSchema,
        await learning.recordSelection(context.get("principal"), input),
      ),
    );
  });
  app.post("/v1/knowledge/learning-reset", async (context) => {
    const input = await parseBody(context, knowledgeSuppressionResetInputSchema);
    return context.json(
      parseKnowledgeResponse(
        knowledgeSuppressionResetResultSchema,
        await learning.resetSuppression(context.get("principal"), input),
      ),
    );
  });
  app.post("/v1/knowledge/forget", async (context) => {
    const input = await parseBody(context, knowledgeForgetInputSchema);
    const result = parseKnowledgeResponse(
      knowledgeMutationResultSchema,
      await forget.forget(context.get("principal"), input),
    );
    return context.json(result, result.outcome === "pending_erasure" ? 202 : 200);
  });
  app.get("/v1/knowledge/operations", requireHuman, async (context) => {
    empty.parse(queryParameters(context));
    return context.json(
      parseKnowledgeResponse(
        activeKnowledgeForgetOperationsSchema,
        await forget.active(context.get("principal")),
      ),
    );
  });
  app.get("/v1/knowledge/operations/:id", async (context) => {
    const input = knowledgeForgetOperationInputSchema.parse(
      pathInput(queryParameters(context), "operationId", context.req.param("id")),
    );
    return context.json(
      parseKnowledgeResponse(
        knowledgeForgetStatusSchema,
        await forget.status(context.get("principal"), input),
      ),
    );
  });
  app.post("/v1/knowledge/operations/:id/retry", requireHuman, async (context) => {
    await parseOptionalBody(context, empty);
    const input = knowledgeForgetOperationInputSchema.parse({
      operationId: context.req.param("id"),
    });
    const principal = context.get("principal");
    if (!forgettingConfigured) {
      const status = await forget.status(principal, input);
      if (status.status === "completed")
        return context.json(parseKnowledgeResponse(knowledgeForgetStatusSchema, status));
      throw new AppError("service_unavailable", "Knowledge forgetting is temporarily unavailable.");
    }
    return context.json(
      parseKnowledgeResponse(knowledgeForgetStatusSchema, await forget.retry(principal, input)),
    );
  });
  app.post("/v1/knowledge/:id/forget-preview", async (context) => {
    const body = await parseOptionalBody(context, object);
    const input = knowledgeForgetPreviewInputSchema.parse(
      pathInput(body, "recordId", context.req.param("id")),
    );
    return context.json(
      parseKnowledgeResponse(
        knowledgeForgetPreviewSchema,
        await forget.preview(context.get("principal"), input),
      ),
    );
  });
  app.post("/v1/knowledge/:id/actions", async (context) => {
    const body = await parseBody(context, object);
    const input = knowledgeLifecycleInputSchema.parse(
      pathInput(body, "recordId", context.req.param("id")),
    );
    return context.json(
      parseKnowledgeResponse(
        knowledgeMutationResultSchema,
        await lifecycle.mutate(context.get("principal"), input),
      ),
    );
  });
  app.get("/v1/knowledge/:id/history", async (context) => {
    const input = knowledgeHistoryInputSchema.parse(
      pathInput(queryParameters(context), "recordId", context.req.param("id")),
    );
    return context.json(
      parseKnowledgeResponse(
        knowledgePageSchema,
        await search.history(context.get("principal"), input),
      ),
    );
  });
  app.get("/v1/knowledge/:id", async (context) => {
    const input = knowledgeReadInputSchema.parse(
      pathInput(queryParameters(context), "id", context.req.param("id")),
    );
    const record = await knowledge.get(context.get("principal"), input);
    return context.json(parseKnowledgeResponse(knowledgeReadResultSchema, { record }));
  });
}
