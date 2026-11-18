import { idSchema } from "@personal-os/domain";
import type { Hono } from "hono";
import { z } from "zod";
import type { createAgentAccountService } from "../agent-account-service.js";
import type { AppEnv } from "../types.js";
import { parseBody, requireHuman } from "./support.js";
export function registerAgentAccountRoutes({
  app,
  accounts,
}: {
  app: Hono<AppEnv>;
  accounts: ReturnType<typeof createAgentAccountService>;
}) {
  app.get("/v1/agent-accounts/current", async (c) =>
    c.json(await accounts.current(c.get("principal"))),
  );
  app.post("/v1/agent-accounts/current", async (c) =>
    c.json(
      await accounts.register(
        c.get("principal"),
        await parseBody(c, z.unknown()),
        c.get("requestId"),
      ),
    ),
  );
  app.get("/v1/agent-accounts", requireHuman, async (c) =>
    c.json(await accounts.list(c.get("principal"))),
  );
  app.patch("/v1/agent-accounts/:id", requireHuman, async (c) =>
    c.json(
      await accounts.update(
        c.get("principal"),
        idSchema.parse(c.req.param("id")),
        await parseBody(c, z.unknown()),
      ),
    ),
  );
  app.put("/v1/agent-accounts/connections/:id", requireHuman, async (c) =>
    c.json(
      await accounts.link(
        c.get("principal"),
        idSchema.parse(c.req.param("id")),
        await parseBody(c, z.unknown()),
      ),
    ),
  );
}
