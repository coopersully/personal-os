import { financeConversationEvidenceReadInputSchema, idSchema } from "@personal-os/domain";
import type { Hono } from "hono";
import type { createFinanceConversationEvidenceService } from "../finance/conversation-evidence-service.js";
import type { AppEnv } from "../types.js";
import { requireScope } from "./support.js";
export function registerFinanceConversationEvidenceRoutes({
  app,
  evidence,
}: {
  app: Hono<AppEnv>;
  evidence: ReturnType<typeof createFinanceConversationEvidenceService>;
}) {
  app.get(
    "/v1/finances/conversation/batches/:runId/evidence",
    requireScope("finances:maintain"),
    async (context) => {
      context.header("cache-control", "no-store");
      return context.json(
        await evidence.readRunEvidence(
          context.get("principal"),
          idSchema.parse(context.req.param("runId")),
          financeConversationEvidenceReadInputSchema.parse(context.req.query()),
        ),
      );
    },
  );
}
