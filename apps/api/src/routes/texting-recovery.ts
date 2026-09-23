import {
  type FinanceTextReplyStatus,
  financeTextReplyStatusSchema,
  idSchema,
} from "@personal-os/domain";
import type { Hono } from "hono";
import { AppError } from "../errors.js";
import type {
  createTextingRecoveryService,
  TextingRecoveryClaim,
} from "../texting-recovery-service.js";
import type { AppEnv } from "../types.js";
import { requireFeatureAccess, requireScope } from "./support.js";

type PublicReason = FinanceTextReplyStatus["reasonCode"];

/** Internal evidence and arbitrary Finance reason text never cross this boundary. */
function publicReason(reason: string | null): PublicReason {
  switch (reason) {
    case null:
      return null;
    case "ambiguous":
      return "ambiguous_reply";
    case "unsupported":
      return "unsupported_reply";
    case "delivery_unconfirmed":
    case "texting_disabled":
    case "consent_revoked":
    case "delivery_failed":
    case "source_unavailable":
      return reason;
    case "finance_receipt_started":
    case "finance_receipt_failed":
      return "finance_pending";
    case "receipt_inspection_failed":
      return "receipt_unavailable";
    case "terminal_receipt_missing":
    case "terminal_receipt_mismatch":
    case "accepted_binding_mismatch":
      return "receipt_mismatch";
    default:
      return "processing_uncertain";
  }
}

function publicStatus(claim: TextingRecoveryClaim): FinanceTextReplyStatus {
  return financeTextReplyStatusSchema.parse({
    inboundMessageId: claim.inboundMessageId,
    state: claim.state,
    reasonCode: publicReason(claim.reason),
    children: claim.children.map((child) => ({
      itemNumber: child.itemNumber,
      state: child.state,
      reasonCode: child.state === "accepted" ? null : publicReason(child.reason),
      terminal: child.terminal,
    })),
    reviewHref: "/settings?section=reviews",
  });
}

/** F registers this GET-only route after composing the recovery service in app.ts. */
export function registerTextingRecoveryRoutes(options: {
  app: Hono<AppEnv>;
  recovery: Pick<ReturnType<typeof createTextingRecoveryService>, "inspectClaim">;
}) {
  const { app, recovery } = options;
  const route = "/v1/texting/finance-replies/:inboundMessageId/status";
  app.get(
    route,
    requireFeatureAccess("texting"),
    requireScope("finances:read"),
    async (context) => {
      const inboundMessageId = idSchema.parse(context.req.param("inboundMessageId"));
      const claim = await recovery.inspectClaim(context.get("principal").userId, inboundMessageId);
      if (!claim) throw new AppError("not_found", "Finance reply status not found.");
      return context.json(publicStatus(claim));
    },
  );
}
