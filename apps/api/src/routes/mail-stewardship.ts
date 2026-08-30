import {
  answerMailQuestionInputSchema,
  createMailObligationInputSchema,
  createMailStewardshipFeedbackInputSchema,
  idSchema,
  maintenanceRequestSchema,
  previewMailResponseBriefInputSchema,
  setMailDispositionInputSchema,
  updateMailObligationInputSchema,
} from "@personal-os/domain";
import type { Context, Hono } from "hono";
import type { MailMaintenanceService } from "../mail-maintenance-service.js";
import type { MailStewardshipService } from "../mail-stewardship-service.js";
import type { AppEnv, Principal } from "../types.js";
import { parseBody, parseOptionalBody, requireFeatureAccess } from "./support.js";

type MutationContext = { principal: Principal; requestId: string };
type MailStewardshipRouteOptions = {
  app: Hono<AppEnv>;
  maintenance: MailMaintenanceService;
  mutationContext: (context: Context<AppEnv>) => MutationContext;
  stewardship: MailStewardshipService;
};

/** Register Mail's server-owned stewardship intents and surgical operations. */
export function registerMailStewardshipRoutes({
  app,
  maintenance,
  mutationContext,
  stewardship,
}: MailStewardshipRouteOptions) {
  const requireMailAccess = requireFeatureAccess("mail");
  app.use("/v1/mail/status", requireMailAccess);
  app.use("/v1/mail/maintenance", requireMailAccess);
  app.use("/v1/mail/maintenance/*", requireMailAccess);
  app.use("/v1/mail/reviews/*", requireMailAccess);
  app.use("/v1/mail/threads/*/stewardship", requireMailAccess);
  app.use("/v1/mail/threads/*/disposition", requireMailAccess);
  app.use("/v1/mail/threads/*/obligations", requireMailAccess);
  app.use("/v1/mail/threads/*/response-brief/preview", requireMailAccess);
  app.use("/v1/mail/obligations/*", requireMailAccess);
  app.use("/v1/mail/questions/*", requireMailAccess);
  app.use("/v1/mail/feedback", requireMailAccess);

  app.get("/v1/mail/status", async (context) =>
    context.json({ status: await stewardship.getStatus(context.get("principal").userId) }),
  );
  app.post("/v1/mail/maintenance", async (context) =>
    context.json(
      await maintenance.maintain(
        context.get("principal").userId,
        await parseOptionalBody(context, maintenanceRequestSchema),
      ),
    ),
  );
  app.get("/v1/mail/maintenance/:id", async (context) =>
    context.json({
      run: await maintenance.getRun(
        context.get("principal").userId,
        idSchema.parse(context.req.param("id")),
      ),
    }),
  );
  app.get("/v1/mail/reviews/:id", async (context) =>
    context.json({
      review: await stewardship.getReview(
        context.get("principal").userId,
        idSchema.parse(context.req.param("id")),
      ),
    }),
  );
  app.get("/v1/mail/threads/:id/stewardship", async (context) =>
    context.json({
      stewardship: await stewardship.getThreadStewardship(
        context.get("principal").userId,
        idSchema.parse(context.req.param("id")),
      ),
    }),
  );
  app.put("/v1/mail/threads/:id/disposition", async (context) =>
    context.json({
      disposition: await stewardship.setDisposition(
        context.get("principal").userId,
        idSchema.parse(context.req.param("id")),
        await parseBody(context, setMailDispositionInputSchema),
        mutationContext(context),
      ),
    }),
  );
  app.post("/v1/mail/threads/:id/obligations", async (context) =>
    context.json(
      {
        obligation: await stewardship.createObligation(
          context.get("principal").userId,
          idSchema.parse(context.req.param("id")),
          await parseBody(context, createMailObligationInputSchema),
          mutationContext(context),
        ),
      },
      201,
    ),
  );
  app.post("/v1/mail/threads/:id/response-brief/preview", async (context) =>
    context.json({
      brief: await stewardship.previewResponseBrief(
        context.get("principal").userId,
        idSchema.parse(context.req.param("id")),
        await parseBody(context, previewMailResponseBriefInputSchema),
      ),
    }),
  );
  app.patch("/v1/mail/obligations/:id", async (context) =>
    context.json({
      obligation: await stewardship.updateObligation(
        context.get("principal").userId,
        idSchema.parse(context.req.param("id")),
        await parseBody(context, updateMailObligationInputSchema),
        mutationContext(context),
      ),
    }),
  );
  app.post("/v1/mail/questions/:id/answer", async (context) =>
    context.json({
      question: await stewardship.answerQuestion(
        context.get("principal").userId,
        idSchema.parse(context.req.param("id")),
        await parseBody(context, answerMailQuestionInputSchema),
        mutationContext(context),
      ),
    }),
  );
  app.post("/v1/mail/feedback", async (context) =>
    context.json(
      {
        feedback: await stewardship.createFeedback(
          context.get("principal").userId,
          await parseBody(context, createMailStewardshipFeedbackInputSchema),
          mutationContext(context),
        ),
      },
      201,
    ),
  );
}
