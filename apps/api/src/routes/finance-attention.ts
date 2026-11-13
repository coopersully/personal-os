import {
  applyFinanceBudgetStartInputSchema,
  confirmFinanceOpeningStatementInputSchema,
  financeMonthSchema,
  idSchema,
  prepareFinanceEvidenceRefreshInputSchema,
  previewFinanceBudgetStartInputSchema,
} from "@personal-os/domain";
import type { Context, Hono } from "hono";
import type { createFinanceAttentionService } from "../finance/attention-service.js";
import type { createFinanceEvidenceRefreshService } from "../finance/evidence-refresh-service.js";
import type { createFinanceOpeningPositionService } from "../finance/opening-position-service.js";
import type { AppEnv } from "../types.js";
import { parseBody, requireScope } from "./support.js";
export function registerFinanceAttentionRoutes({
  app,
  attention,
  opening,
  refresh,
}: {
  app: Hono<AppEnv>;
  attention: ReturnType<typeof createFinanceAttentionService>;
  opening: ReturnType<typeof createFinanceOpeningPositionService>;
  refresh: ReturnType<typeof createFinanceEvidenceRefreshService>;
}) {
  const context = (c: Context<AppEnv>) => ({
    principal: c.get("principal"),
    requestId: c.get("requestId"),
  });
  for (const path of [
    "attention",
    "budget-start",
    "opening-position",
    "opening-statements",
    "evidence-refresh",
  ])
    app.use(`/v1/finances/${path}*`, async (c, next) => {
      c.header("Cache-Control", "no-store");
      await next();
    });
  app.get("/v1/finances/attention", requireScope("finances:read"), async (c) =>
    c.json(await attention.getAttentionSnapshot(c.get("principal").userId)),
  );
  app.get("/v1/finances/budget-start", requireScope("finances:read"), async (c) =>
    c.json(await attention.getBudgetStart(c.get("principal").userId)),
  );
  app.post(
    "/v1/finances/budget-start/previews",
    requireScope("finances:read"),
    requireScope("finances:write"),
    async (c) =>
      c.json(
        await attention.previewBudgetStart(
          context(c),
          await parseBody(c, previewFinanceBudgetStartInputSchema),
        ),
        201,
      ),
  );
  app.get("/v1/finances/budget-start/previews/:id", requireScope("finances:read"), async (c) =>
    c.json(await attention.getBudgetStartPreview(context(c), idSchema.parse(c.req.param("id")))),
  );
  // Owner-only: the service refuses every agent principal regardless of scope.
  app.post(
    "/v1/finances/budget-start/previews/:id/decline",
    requireScope("finances:read"),
    requireScope("finances:write"),
    async (c) =>
      c.json(
        await attention.declineBudgetStartPreview(context(c), idSchema.parse(c.req.param("id"))),
      ),
  );
  app.post("/v1/finances/budget-start/approve", requireScope("finances:write"), async (c) =>
    c.json(
      await attention.applyBudgetStart(
        context(c),
        await parseBody(c, applyFinanceBudgetStartInputSchema),
      ),
    ),
  );
  app.get("/v1/finances/opening-position", requireScope("finances:read"), async (c) =>
    c.json(
      await opening.readOpeningPosition(
        c.get("principal").userId,
        financeMonthSchema.parse(c.req.query("month")),
      ),
    ),
  );
  app.post("/v1/finances/opening-statements", requireScope("finances:write"), async (c) =>
    c.json(
      await opening.confirmOpeningStatement(
        context(c),
        await parseBody(c, confirmFinanceOpeningStatementInputSchema),
      ),
      201,
    ),
  );
  app.post(
    "/v1/finances/evidence-refresh",
    requireScope("finances:read"),
    requireScope("finances:write"),
    requireScope("finances:maintain"),
    async (c) =>
      c.json(
        await refresh.prepareEvidenceRefresh(
          context(c),
          await parseBody(c, prepareFinanceEvidenceRefreshInputSchema),
        ),
        202,
      ),
  );
  app.get("/v1/finances/evidence-refresh/:id", requireScope("finances:read"), async (c) =>
    c.json(await refresh.getEvidenceRefresh(context(c), idSchema.parse(c.req.param("id")))),
  );
}
