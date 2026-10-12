import type { McpServer } from "@modelcontextprotocol/server";
import type { PersonalOsApiClient } from "@personal-os/api-client";
import {
  activateMailRuleInputSchema,
  answerMailQuestionInputSchema,
  createMailDraftInputSchema,
  createMailObligationInputSchema,
  createMailStewardshipFeedbackInputSchema,
  idSchema,
  previewMailResponseBriefInputSchema,
  reconcileMailDraftInputSchema,
  sendMailDraftInputSchema,
  setMailDispositionInputSchema,
  updateMailDraftInputSchema,
  updateMailObligationInputSchema,
} from "@personal-os/domain";
import { z } from "zod";
import { apiResult } from "../tool-result.js";

export function registerMailManagementTools(server: McpServer, api: PersonalOsApiClient) {
  server.registerTool(
    "download_mail_attachment",
    {
      title: "Download mail attachment",
      description:
        "Read an owned message attachment as base64 data with filename, contentType and byte size. The API enforces a 10 MB limit and authenticated provider access; no session-only URL is returned. Requires mail:read.",
      inputSchema: {
        messageId: idSchema,
        attachmentId: z
          .string()
          .min(1)
          .max(2048)
          .describe(
            "Opaque attachment ID returned in read_mail messages; provider IDs are not UUIDs",
          ),
      },
    },
    async ({ messageId, attachmentId }) =>
      apiResult(() => api.downloadMailAttachment(messageId, attachmentId)),
  );

  server.registerTool(
    "list_mail_drafts",
    {
      title: "List mail drafts",
      description:
        "List saved drafts, exact updatedAt revisions, and delivery reconciliation states. Requires mail:read.",
      inputSchema: {},
    },
    async () => apiResult(() => api.listMailDrafts()),
  );
  server.registerTool(
    "create_mail_draft",
    {
      title: "Create mail draft",
      description:
        "Save an editable draft in an owned sending account. This does not send mail. Requires mail:write.",
      inputSchema: createMailDraftInputSchema,
    },
    async (input) => apiResult(() => api.createMailDraft(input)),
  );
  server.registerTool(
    "update_mail_draft",
    {
      title: "Update mail draft",
      description:
        "Replace draft content using its observed updatedAt as expectedUpdatedAt. This does not send mail. Requires mail:write.",
      inputSchema: updateMailDraftInputSchema.safeExtend({ draftId: idSchema }),
    },
    async ({ draftId, ...input }) => apiResult(() => api.updateMailDraft(draftId, input)),
  );
  server.registerTool(
    "delete_mail_draft",
    {
      title: "Delete mail draft",
      description:
        "Delete an editable draft. Sent or uncertain deliveries cannot be deleted through this operation. Requires mail:write.",
      inputSchema: { draftId: idSchema },
    },
    async ({ draftId }) =>
      apiResult(async () => {
        await api.deleteMailDraft(draftId);
        return { deleted: true };
      }),
  );
  server.registerTool(
    "send_mail_draft",
    {
      title: "Send mail draft",
      description:
        "Send the exact saved draft revision confirmed by confirmedUpdatedAt. Inspect recipients and content first. An uncertain delivery requires Sent Mail reconciliation before retry; sending cannot be undone. Requires mail:write. Agents also require mail:execute and enabled review bypass.",
      inputSchema: sendMailDraftInputSchema,
    },
    async (input) =>
      apiResult(async () => {
        await api.sendMailDraft(input);
        return { sent: true };
      }),
  );
  server.registerTool(
    "reconcile_mail_draft",
    {
      title: "Reconcile mail draft",
      description:
        "Resolve an uncertain delivery only after checking Sent Mail evidence. This records sent or not_sent and never resends. Requires mail:write. Agents also require mail:execute and enabled review bypass.",
      inputSchema: reconcileMailDraftInputSchema.safeExtend({ draftId: idSchema }),
    },
    async ({ draftId, ...input }) => apiResult(() => api.reconcileMailDraft(draftId, input)),
  );
  server.registerTool(
    "activate_mail_rule",
    {
      title: "Activate mail rule",
      description:
        "Activate the exact saved rule version and current bounded preview. Preserve the returned sample fingerprint and preview timestamp; stale evidence is rejected. Requires mail:write. Agents also require mail:execute and enabled review bypass.",
      inputSchema: activateMailRuleInputSchema.safeExtend({ ruleId: idSchema }),
    },
    async ({ ruleId, ...input }) => apiResult(() => api.activateMailRule(ruleId, input)),
  );
  server.registerTool(
    "get_mail_maintenance_run",
    {
      title: "Get mail maintenance run",
      description:
        "Read one durable maintenance run and its actual terminal or pending state. Requires mail:read.",
      inputSchema: { runId: idSchema },
    },
    async ({ runId }) => apiResult(() => api.getMailMaintenanceRun(runId)),
  );
  server.registerTool(
    "get_mail_review",
    {
      title: "Get mail review",
      description: "Read an immutable maintenance review and its evidence. Requires mail:read.",
      inputSchema: { reviewId: idSchema },
    },
    async ({ reviewId }) => apiResult(() => api.getMailReview(reviewId)),
  );
  server.registerTool(
    "get_mail_thread_stewardship",
    {
      title: "Get mail thread stewardship",
      description:
        "Read conversation disposition, obligations and related questions. Requires mail:read.",
      inputSchema: { threadId: idSchema },
    },
    async ({ threadId }) => apiResult(() => api.getMailThreadStewardship(threadId)),
  );
  server.registerTool(
    "preview_mail_response_brief",
    {
      title: "Preview mail response brief",
      description:
        "Prepare an evidence-backed response brief for a conversation. Does not send mail. Requires mail:write.",
      inputSchema: previewMailResponseBriefInputSchema.safeExtend({ threadId: idSchema }),
    },
    async ({ threadId, ...input }) =>
      apiResult(() => api.previewMailResponseBrief(threadId, input)),
  );
  server.registerTool(
    "set_mail_disposition",
    {
      title: "Set mail disposition",
      description:
        "Set the conversation disposition using the current version and cited evidence. Requires mail:write. Agents also require mail:execute and enabled review bypass.",
      inputSchema: setMailDispositionInputSchema.safeExtend({ threadId: idSchema }),
    },
    async ({ threadId, ...input }) => apiResult(() => api.setMailDisposition(threadId, input)),
  );
  server.registerTool(
    "create_mail_obligation",
    {
      title: "Create mail obligation",
      description:
        "Record a conversation obligation with its supporting evidence. Requires mail:write. Agents also require mail:execute and enabled review bypass.",
      inputSchema: createMailObligationInputSchema.safeExtend({ threadId: idSchema }),
    },
    async ({ threadId, ...input }) => apiResult(() => api.createMailObligation(threadId, input)),
  );
  server.registerTool(
    "update_mail_obligation",
    {
      title: "Update mail obligation",
      description:
        "Update the exact observed obligation version. Requires mail:write. Agents also require mail:execute and enabled review bypass.",
      inputSchema: updateMailObligationInputSchema.safeExtend({ obligationId: idSchema }),
    },
    async ({ obligationId, ...input }) =>
      apiResult(() => api.updateMailObligation(obligationId, input)),
  );
  server.registerTool(
    "get_mail_question",
    {
      title: "Get mail question",
      description:
        "Read an owned stewardship question and the evidence needed to answer it. Requires mail:read.",
      inputSchema: { questionId: idSchema },
    },
    async ({ questionId }) => apiResult(() => api.getMailQuestion(questionId)),
  );
  server.registerTool(
    "answer_mail_question",
    {
      title: "Answer mail question",
      description:
        "Answer a stewardship question from established evidence; uncertainty is not permission to invent an answer. Requires mail:write. Agents also require mail:execute and enabled review bypass.",
      inputSchema: answerMailQuestionInputSchema.safeExtend({ questionId: idSchema }),
    },
    async ({ questionId, ...input }) => apiResult(() => api.answerMailQuestion(questionId, input)),
  );
  server.registerTool(
    "create_mail_stewardship_feedback",
    {
      title: "Create mail stewardship feedback",
      description:
        "Record feedback on a maintenance outcome with its source references. Requires mail:write. Agents also require mail:execute and enabled review bypass.",
      inputSchema: createMailStewardshipFeedbackInputSchema,
    },
    async (input) => apiResult(() => api.createMailStewardshipFeedback(input)),
  );
}
