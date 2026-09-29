import {
  activateMailRuleInputSchema,
  bulkUpdateMailInputSchema,
  createMailDraftInputSchema,
  createMailRuleInputSchema,
  mailListQuerySchema,
  mailSnoozeInputSchema,
  previewMailRuleInputSchema,
  reconcileMailDraftInputSchema,
  sendMailDraftInputSchema,
  updateMailDraftInputSchema,
  updateMailRuleInputSchema,
  updateMailThreadInputSchema,
  upsertMailAttentionItemInputSchema,
} from "@personal-os/domain";
import type { Context, Hono } from "hono";
import type { createMailService } from "../mail-service.js";
import type { AppEnv, Principal } from "../types.js";
import { parseBody, requireFeatureAccess, requireHuman, requireScope } from "./support.js";

type MutationContext = { principal: Principal; requestId: string };

type MailRouteOptions = {
  app: Hono<AppEnv>;
  mail: ReturnType<typeof createMailService>;
  mutationContext: (context: Context<AppEnv>) => MutationContext;
};

/** Register the Mail-owned HTTP surface. */
export function registerMailRoutes({ app, mail, mutationContext }: MailRouteOptions) {
  app.use("/v1/mailboxes", requireScope("mail:read"));
  const mailReadAccess = requireScope("mail:read");
  const mailFeatureAccess = requireFeatureAccess("mail");
  app.use("/v1/mail/*", (context, next) =>
    context.req.method === "POST" && context.req.path === "/v1/mail/rules/preview"
      ? mailReadAccess(context, next)
      : mailFeatureAccess(context, next),
  );
  app.use("/v1/mail/rules/:id/activate", requireHuman);
  app.use("/v1/mail/send", requireHuman);
  app.use("/v1/mail/drafts/:id/reconcile", requireHuman);
  app.get("/v1/mailboxes", async (context) =>
    context.json({ mailboxes: await mail.listMailboxes(context.get("principal").userId) }),
  );
  app.get("/v1/mail/setup-context", async (context) =>
    context.json({ setup: await mail.listSetupContext(context.get("principal").userId) }),
  );
  app.get("/v1/mail/drafts", async (context) =>
    context.json({ drafts: await mail.listDrafts(context.get("principal").userId) }),
  );
  app.post("/v1/mail/drafts", async (context) =>
    context.json(
      {
        draft: await mail.createDraft(
          context.get("principal").userId,
          await parseBody(context, createMailDraftInputSchema),
        ),
      },
      201,
    ),
  );
  app.patch("/v1/mail/drafts/:id", async (context) =>
    context.json({
      draft: await mail.updateDraft(
        context.get("principal").userId,
        context.req.param("id"),
        await parseBody(context, updateMailDraftInputSchema),
      ),
    }),
  );
  app.delete("/v1/mail/drafts/:id", async (context) => {
    await mail.deleteDraft(context.get("principal").userId, context.req.param("id"));
    return context.body(null, 204);
  });
  app.post("/v1/mail/send", async (context) => {
    await mail.sendDraft(
      context.get("principal").userId,
      await parseBody(context, sendMailDraftInputSchema),
      mutationContext(context),
    );
    return context.body(null, 204);
  });
  app.post("/v1/mail/drafts/:id/reconcile", async (context) =>
    context.json({
      draft: await mail.reconcileDraft(
        context.get("principal").userId,
        context.req.param("id"),
        (await parseBody(context, reconcileMailDraftInputSchema)).outcome,
        mutationContext(context),
      ),
    }),
  );
  app.get("/v1/mail/rules", async (context) =>
    context.json({ rules: await mail.listRules(context.get("principal").userId) }),
  );
  app.post("/v1/mail/rules", async (context) =>
    context.json(
      {
        rule: await mail.createRule(
          await parseBody(context, createMailRuleInputSchema),
          mutationContext(context),
        ),
      },
      201,
    ),
  );
  app.post("/v1/mail/rules/preview", async (context) =>
    context.json({
      preview: await mail.previewRule(
        context.get("principal").userId,
        await parseBody(context, previewMailRuleInputSchema),
      ),
    }),
  );
  app.get("/v1/mail/rules/:id/preview", async (context) =>
    context.json({
      preview: await mail.previewSavedRule(
        context.get("principal").userId,
        context.req.param("id"),
      ),
    }),
  );
  app.post("/v1/mail/rules/:id/activate", async (context) =>
    context.json(
      await mail.activateRule(
        context.req.param("id"),
        await parseBody(context, activateMailRuleInputSchema),
        mutationContext(context),
      ),
    ),
  );
  app.patch("/v1/mail/rules/:id", async (context) =>
    context.json({
      rule: await mail.updateRule(
        context.req.param("id"),
        await parseBody(context, updateMailRuleInputSchema),
        mutationContext(context),
      ),
    }),
  );
  app.post("/v1/mail/threads/bulk", async (context) =>
    context.json({
      result: await mail.bulkUpdateThreads(
        await parseBody(context, bulkUpdateMailInputSchema),
        mutationContext(context),
      ),
    }),
  );
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
  app.put("/v1/mail/threads/:id/attention", async (context) =>
    context.json({
      item: await mail.upsertAttentionItem(
        context.req.param("id"),
        await parseBody(context, upsertMailAttentionItemInputSchema),
        mutationContext(context),
      ),
    }),
  );
}
