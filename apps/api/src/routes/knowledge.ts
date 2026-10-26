import { knowledgeMutationInputSchema, knowledgeReadInputSchema } from "@personal-os/domain";
import type { Hono } from "hono";
import type { createKnowledgeRecordService } from "../knowledge/record-service.js";
import type { AppEnv } from "../types.js";
import { parseBody } from "./support.js";

/** Knowledge owns authorization, provenance and persistence; routes only parse intent. */
export function registerKnowledgeRoutes({
  app,
  knowledge,
}: {
  app: Hono<AppEnv>;
  knowledge: ReturnType<typeof createKnowledgeRecordService>;
}) {
  app.post("/v1/knowledge", async (context) =>
    context.json(
      await knowledge.create(
        context.get("principal"),
        await parseBody(context, knowledgeMutationInputSchema),
      ),
      201,
    ),
  );
  app.get("/v1/knowledge/:id", async (context) =>
    context.json({
      record: await knowledge.get(
        context.get("principal"),
        knowledgeReadInputSchema.parse({
          id: context.req.param("id"),
          purpose: context.req.query("purpose"),
        }),
      ),
    }),
  );
}
