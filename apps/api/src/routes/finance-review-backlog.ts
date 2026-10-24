import {
  executeFinanceReviewBatchInputSchema,
  financeReviewBacklogQuerySchema,
  idSchema,
  listFinanceReviewBatchesInputSchema,
  previewFinanceReviewBatchInputSchema,
} from "@personal-os/domain";
import type { Context, Hono } from "hono";
import type { createFinanceReviewBacklogService } from "../finance/review-backlog-service.js";
import type { createFinanceReviewBatchService } from "../finance/review-batch-service.js";
import type { AppEnv } from "../types.js";
import { parseBody, requireScope } from "./support.js";

export function registerFinanceReviewBacklogRoutes({
  app,
  backlog,
  batches,
}: {
  app: Hono<AppEnv>;
  backlog: ReturnType<typeof createFinanceReviewBacklogService>;
  batches: ReturnType<typeof createFinanceReviewBatchService>;
}) {
  const context = (c: Context<AppEnv>) => ({
    principal: c.get("principal"),
    requestId: c.get("requestId"),
  });
  app.use("/v1/finances/review-backlog*", async (c, next) => {
    c.header("Cache-Control", "no-store");
    await next();
  });
  app.use("/v1/finances/review-batches*", async (c, next) => {
    c.header("Cache-Control", "no-store");
    await next();
  });
  app.get("/v1/finances/review-backlog", requireScope("finances:read"), async (c) =>
    c.json(await backlog.assess(c.get("principal").userId)),
  );
  app.get("/v1/finances/review-backlog/items", requireScope("finances:read"), async (c) =>
    c.json(
      await backlog.list(
        c.get("principal").userId,
        financeReviewBacklogQuerySchema.parse(c.req.query()),
      ),
    ),
  );
  app.get("/v1/finances/review-batches", requireScope("finances:read"), async (c) =>
    c.json(
      await batches.list(context(c), listFinanceReviewBatchesInputSchema.parse(c.req.query())),
    ),
  );
  app.post("/v1/finances/review-batches", requireScope("finances:write"), async (c) =>
    c.json(
      await batches.preview(await parseBody(c, previewFinanceReviewBatchInputSchema), context(c)),
      201,
    ),
  );
  app.get("/v1/finances/review-batches/:id", requireScope("finances:read"), async (c) =>
    c.json(await batches.get(idSchema.parse(c.req.param("id")), context(c))),
  );
  // Execution authority and revocation are checked inside every item's transaction.
  app.post("/v1/finances/review-batches/:id/execute", requireScope("finances:write"), async (c) =>
    c.json(
      await batches.execute(
        idSchema.parse(c.req.param("id")),
        await parseBody(c, executeFinanceReviewBatchInputSchema),
        { ...context(c), signal: c.req.raw.signal },
      ),
    ),
  );
}
