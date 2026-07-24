import {
  mailDraftInputSchema,
  mailListQuerySchema,
  mailRuleInputSchema,
  mailSnoozeInputSchema,
  sendMailInputSchema,
  updateMailThreadInputSchema,
} from "@personal-os/domain";
import type { Hono } from "hono";
import type { createMailService } from "../mail-service.js";
import type { AppEnv } from "../types.js";
import { parseBody, requireFeatureAccess, requireScope } from "./support.js";

type MailRouteOptions = {
  app: Hono<AppEnv>;
  mail: ReturnType<typeof createMailService>;
};

/** Register the Mail-owned HTTP surface. */
export function registerMailRoutes({ app, mail }: MailRouteOptions) {
  app.use("/v1/mailboxes", requireScope("mail:read"));
  app.use("/v1/mail/*", requireFeatureAccess("mail"));
  app.get("/v1/mailboxes", async (context) =>
    context.json({ mailboxes: await mail.listMailboxes(context.get("principal").userId) }),
  );
  app.get("/v1/mail/drafts", async (context) =>
    context.json({ drafts: await mail.listDrafts(context.get("principal").userId) }),
  );
  app.get("/v1/mail/rules", async (context) =>
    context.json({ rules: await mail.listRules(context.get("principal").userId) }),
  );
  app.post("/v1/mail/rules", async (context) =>
    context.json(
      {
        rule: await mail.createRule(
          context.get("principal").userId,
          await parseBody(context, mailRuleInputSchema),
        ),
      },
      201,
    ),
  );
  app.post("/v1/mail/drafts", async (context) =>
    context.json(
      {
        draft: await mail.createDraft(
          context.get("principal").userId,
          await parseBody(context, mailDraftInputSchema),
        ),
      },
      201,
    ),
  );
  app.post("/v1/mail/send", async (context) => {
    await mail.send(context.get("principal").userId, await parseBody(context, sendMailInputSchema));
    return context.body(null, 202);
  });
  app.get("/v1/mail/threads", async (context) =>
    context.json({
      threads: await mail.listThreads(
        context.get("principal").userId,
        mailListQuerySchema.parse(context.req.query()),
      ),
    }),
  );
  app.get("/v1/mail/threads/:id/messages", async (context) =>
    context.json({
      messages: await mail.listMessages(context.get("principal").userId, context.req.param("id")),
    }),
  );
  app.get("/v1/mail/threads/:id", async (context) =>
    context.json({
      thread: await mail.getThread(context.get("principal").userId, context.req.param("id")),
    }),
  );
  app.patch("/v1/mail/threads/:id", async (context) =>
    context.json({
      thread: await mail.updateThread(
        context.get("principal").userId,
        context.req.param("id"),
        await parseBody(context, updateMailThreadInputSchema),
        context.get("principal"),
        context.get("requestId"),
      ),
    }),
  );
  app.post("/v1/mail/threads/:id/snooze", async (context) => {
    const input = await parseBody(context, mailSnoozeInputSchema);
    await mail.snoozeThread(
      context.get("principal").userId,
      context.req.param("id"),
      new Date(input.until),
    );
    return context.body(null, 204);
  });
}
