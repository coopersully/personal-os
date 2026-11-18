import { idSchema, refreshFinanceMaintenanceExecutionInputSchema } from "@personal-os/domain";
import type { Hono } from "hono";
import { z } from "zod";
import type { createFinanceMaintenanceExecutionService } from "../finance/maintenance-execution-service.js";
import type { AppEnv } from "../types.js";
import { parseBody, requireScope } from "./support.js";
export function registerFinanceMaintenanceExecutionRoutes({
  app,
  execution,
}: {
  app: Hono<AppEnv>;
  execution: ReturnType<typeof createFinanceMaintenanceExecutionService>;
}) {
  const root = "/v1/finances/maintenance/runs/:runId/execution-authorization";
  app.get(root, requireScope("finances:maintain"), async (c) => {
    c.header("cache-control", "no-store");
    z.strictObject({}).parse(c.req.query());
    return c.json(
      await execution.readMaintenanceExecutionAuthorization(
        c.get("principal"),
        idSchema.parse(c.req.param("runId")),
      ),
    );
  });
  app.post(`${root}/refresh`, requireScope("finances:maintain"), async (c) => {
    c.header("cache-control", "no-store");
    return c.json(
      await execution.refreshMaintenanceExecutionAuthorization(
        c.get("principal"),
        idSchema.parse(c.req.param("runId")),
        await parseBody(c, refreshFinanceMaintenanceExecutionInputSchema),
      ),
    );
  });
}
