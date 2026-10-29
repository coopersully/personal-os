import {
  financeConversationAcknowledgmentInputSchema,
  financeConversationProofOperationSchema,
  financeConversationRenderedInputSchema,
  financeConversationReplyInputSchema,
  financeConversationSendInputSchema,
  financeConversationSequenceSchema,
  idSchema,
} from "@personal-os/domain";
import type { Hono } from "hono";
import { z } from "zod";
import type { createFinanceConversationService } from "../finance/conversation-persistence.js";
import type { AppEnv } from "../types.js";
import { parseBody, requireHuman, requireScope } from "./support.js";

const querySchema = z
  .object({
    after: financeConversationSequenceSchema.default("0"),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();
const batchQuerySchema = z
  .object({
    cursor: z.string().min(1).max(2000).default("0"),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();

/** Leaf adapter only. Authentication/composition remains in the existing API root. */
export function registerFinanceConversationRoutes({
  app,
  conversation,
}: {
  app: Hono<AppEnv>;
  conversation: ReturnType<typeof createFinanceConversationService>;
}) {
  const root = "/v1/finances/conversation";
  app.use(`${root}/*`, async (context, next) => {
    context.header("cache-control", "no-store");
    await next();
  });
  app.get(`${root}/readiness`, requireScope("finances:read"), requireHuman, async (context) =>
    context.json({ readiness: await conversation.getReadiness(context.get("principal").userId) }),
  );
  app.get(
    `${root}/hosts/:scheduleId/readiness`,
    requireScope("finances:read"),
    requireHuman,
    async (context) =>
      context.json({
        readiness: await conversation.getHostReadiness(
          context.get("principal").userId,
          idSchema.parse(context.req.param("scheduleId")),
        ),
      }),
  );
  // Only the human owner can read live conversation history. Agents page a saved run batch.
  app.get(`${root}/messages`, requireScope("finances:read"), requireHuman, async (context) => {
    const query = querySchema.parse(context.req.query());
    return context.json(
      await conversation.history(context.get("principal").userId, query.after, query.limit),
    );
  });
  app.get(
    `${root}/messages/:messageId/context`,
    requireScope("finances:read"),
    requireHuman,
    async (context) => {
      // Missing and foreign IDs have the same owner-scoped not-found response.
      z.object({}).strict().parse(context.req.query());
      return context.json(
        await conversation.messageContext(
          context.get("principal").userId,
          idSchema.parse(context.req.param("messageId")),
        ),
      );
    },
  );
  app.post(`${root}/messages`, requireScope("finances:write"), requireHuman, async (context) =>
    context.json(
      {
        message: await conversation.send(
          context.get("principal"),
          await parseBody(context, financeConversationSendInputSchema),
        ),
      },
      201,
    ),
  );
  app.post(`${root}/rendered`, requireScope("finances:write"), requireHuman, async (context) => {
    const input = await parseBody(context, financeConversationRenderedInputSchema);
    return context.json(
      await conversation.markRendered(context.get("principal"), input.throughSequence),
    );
  });
  app.get(`${root}/batches/:runId`, requireScope("finances:maintain"), async (context) => {
    const query = batchQuerySchema.parse(context.req.query());
    return context.json(
      await conversation.pageBatch(
        context.get("principal"),
        idSchema.parse(context.req.param("runId")),
        query.cursor,
        query.limit,
      ),
    );
  });
  app.post(
    `${root}/batches/:runId/acknowledgments`,
    requireScope("finances:maintain"),
    async (context) => {
      const input = await parseBody(context, financeConversationAcknowledgmentInputSchema);
      return context.json(
        await conversation.acknowledgeBatch(
          context.get("principal"),
          idSchema.parse(context.req.param("runId")),
          input.messageIds,
        ),
      );
    },
  );
  app.post(`${root}/batches/:runId/replies`, requireScope("finances:maintain"), async (context) => {
    const input = await parseBody(context, financeConversationReplyInputSchema);
    return context.json(
      {
        message: await conversation.reply(context.get("principal"), {
          ...input,
          runId: idSchema.parse(context.req.param("runId")),
        }),
      },
      201,
    );
  });
  app.post(
    `${root}/hosts/:scheduleId/challenges`,
    requireScope("finances:write"),
    requireHuman,
    async (context) =>
      context.json(
        {
          challenge: await conversation.issueChallenge(
            context.get("principal"),
            idSchema.parse(context.req.param("scheduleId")),
          ),
        },
        201,
      ),
  );
  app.post(
    `${root}/challenges/:challengeId/exchange`,
    requireScope("finances:maintain"),
    async (context) =>
      context.json(
        await conversation.advanceChallenge(
          context.get("principal"),
          idSchema.parse(context.req.param("challengeId")),
          await parseBody(context, financeConversationProofOperationSchema),
        ),
      ),
  );
}
