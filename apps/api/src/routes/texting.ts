import {
  checkTextingVerificationInputSchema,
  sendTextMessageInputSchema,
  startTextingVerificationInputSchema,
  textConversationQuerySchema,
} from "@personal-os/domain";
import type { Context, Hono } from "hono";
import { readBoundedRequestBody } from "../request-body.js";
import type { createTextingService } from "../texting-service.js";
import type { AppEnv } from "../types.js";
import { parseBody, requireFeatureAccess, requireHuman } from "./support.js";

const TWILIO_WEBHOOK_BODY_LIMIT_BYTES = 16_384;

/** Register account texting and signed, payload-bounded Twilio webhook routes. */
export function registerTextingRoutes(options: {
  app: Hono<AppEnv>;
  texting: ReturnType<typeof createTextingService>;
  validateWebhook?: (signature: string, url: string, parameters: Record<string, string>) => boolean;
}) {
  const { app, texting } = options;
  app.use("/v1/texting", requireFeatureAccess("texting"));
  app.use("/v1/texting/*", requireFeatureAccess("texting"));

  app.get("/v1/texting", async (context) =>
    context.json({ connection: await texting.getConnection(context.get("principal").userId) }),
  );
  app.post("/v1/texting/verification", requireHuman, async (context) =>
    context.json(
      {
        challenge: await texting.startVerification(
          context.get("principal").userId,
          await parseBody(context, startTextingVerificationInputSchema),
        ),
      },
      201,
    ),
  );
  app.post("/v1/texting/verification/:id/check", requireHuman, async (context) =>
    context.json({
      connection: await texting.checkVerification(
        context.get("principal").userId,
        context.req.param("id"),
        (await parseBody(context, checkTextingVerificationInputSchema)).code,
      ),
    }),
  );
  app.delete("/v1/texting", requireHuman, async (context) => {
    await texting.disconnect(context.get("principal").userId);
    return context.body(null, 204);
  });
  app.get("/v1/texting/conversation", async (context) =>
    context.json(
      await texting.conversation(
        context.get("principal"),
        context.req.query("timeZone") ?? "UTC",
        textConversationQuerySchema.parse(context.req.query()),
      ),
    ),
  );
  app.post("/v1/texting/messages", async (context) =>
    context.json(
      {
        message: await texting.send(
          context.get("principal"),
          context.req.query("timeZone") ?? "UTC",
          await parseBody(context, sendTextMessageInputSchema),
        ),
      },
      201,
    ),
  );

  async function webhook(
    context: Context<AppEnv>,
    handler: (parameters: Record<string, string>) => Promise<void>,
  ) {
    const raw = await readBoundedRequestBody(context.req.raw, TWILIO_WEBHOOK_BODY_LIMIT_BYTES);
    if (raw === null) return context.text("Payload too large", 413);
    const parameters = Object.fromEntries(new URLSearchParams(raw));
    const signature = context.req.header("x-twilio-signature") ?? "";
    if (!options.validateWebhook?.(signature, context.req.url, parameters))
      return context.text("Invalid signature", 403);
    await handler(parameters);
    return context.body(null, 204);
  }
  app.post("/v1/webhooks/twilio/inbound", (context) => webhook(context, texting.inbound));
  app.post("/v1/webhooks/twilio/message-status", (context) =>
    webhook(context, texting.updateStatus),
  );
}
