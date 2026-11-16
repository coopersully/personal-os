import {
  knowledgeContextExplanationSchema,
  knowledgeContextPackSchema,
  knowledgeExplainInputSchema,
  knowledgeExportInputSchema,
  knowledgeHistoryInputSchema,
  knowledgeLifecycleInputSchema,
  knowledgeMutationInputSchema,
  knowledgeMutationResultSchema,
  knowledgePageSchema,
  knowledgeQuerySchema,
  knowledgeReadInputSchema,
  knowledgeReadResultSchema,
  knowledgeSaveResultSchema,
  knowledgeTagIndexInputSchema,
  knowledgeTagIndexSchema,
  knowledgeTagMergeInputSchema,
  knowledgeTagMergeSchema,
  knowledgeTagUnmergeInputSchema,
} from "@personal-os/domain";
import type { Context, Hono } from "hono";
import { z } from "zod";
import { AppError } from "../errors.js";
import type { createKnowledgeContextService } from "../knowledge/context-service.js";
import type { createKnowledgeExportService } from "../knowledge/export-service.js";
import type { createKnowledgeLifecycleService } from "../knowledge/lifecycle-service.js";
import type { createKnowledgeRecordService } from "../knowledge/record-service.js";
import type { createKnowledgeSearchService } from "../knowledge/search-service.js";
import type { createKnowledgeTagService } from "../knowledge/tag-service.js";
import type { AppEnv } from "../types.js";
import { parseBody } from "./support.js";

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

const knowledgeTagIndexQuerySchema = z
  .object({
    limit: z
      .string()
      .regex(/^\d{1,3}$/)
      .transform(Number)
      .optional(),
  })
  .strict();

function queryParameters(context: Context, repeated: readonly string[] = []) {
  return Object.fromEntries(
    Object.entries(context.req.queries()).map(([key, values]) => [
      key,
      repeated.includes(key) || values.length > 1 ? values : values[0],
    ]),
  );
}

function pathInput(input: Record<string, unknown>, key: string, value: string) {
  if (Object.hasOwn(input, key))
    throw new AppError("invalid_request", "The ID must come from the path.");
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
  search,
  context: contextService,
  export: exportService,
  tags,
}: {
  app: Hono<AppEnv>;
  knowledge: ReturnType<typeof createKnowledgeRecordService>;
  lifecycle: ReturnType<typeof createKnowledgeLifecycleService>;
  search: ReturnType<typeof createKnowledgeSearchService>;
  context: ReturnType<typeof createKnowledgeContextService>;
  export: ReturnType<typeof createKnowledgeExportService>;
  tags: ReturnType<typeof createKnowledgeTagService>;
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
      queryParameters(context, ["entityRefs", "tags"]),
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
  app.get("/v1/knowledge/tags", async (context) => {
    const input = knowledgeTagIndexInputSchema.parse(
      knowledgeTagIndexQuerySchema.parse(queryParameters(context)),
    );
    return context.json(
      parseKnowledgeResponse(
        knowledgeTagIndexSchema,
        await tags.index(context.get("principal"), input),
      ),
    );
  });
  app.post("/v1/knowledge/tags/merge", async (context) => {
    const input = await parseBody(context, knowledgeTagMergeInputSchema);
    return context.json(
      parseKnowledgeResponse(
        knowledgeTagMergeSchema,
        await tags.merge(context.get("principal"), input),
      ),
    );
  });
  // Person only: the service refuses agents.
  app.post("/v1/knowledge/tags/unmerge", async (context) => {
    const input = await parseBody(context, knowledgeTagUnmergeInputSchema);
    return context.json(
      parseKnowledgeResponse(
        knowledgeTagMergeSchema,
        await tags.unmerge(context.get("principal"), input),
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
  // Only UUID-shaped segments are record reads; other single segments are unknown routes.
  app.get("/v1/knowledge/:id{[0-9a-fA-F-]{36}}", async (context) => {
    const input = knowledgeReadInputSchema.parse(
      pathInput(queryParameters(context), "id", context.req.param("id")),
    );
    const result = await knowledge.get(context.get("principal"), input);
    // The owner reads a purged ID as a content-free tombstone; agents get 404 instead.
    return context.json(
      parseKnowledgeResponse(
        knowledgeReadResultSchema,
        "state" in result ? result : { record: result },
      ),
    );
  });
}
