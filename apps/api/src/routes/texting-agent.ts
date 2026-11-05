import { idSchema } from "@personal-os/domain";
import type { Hono } from "hono";
import { z } from "zod";
import type { createTextingAgentService } from "../texting-agent-service.js";
import type { AppEnv } from "../types.js";
import { parseBody, requireHuman } from "./support.js";

export function registerTextingAgentRoutes(
  app: Hono<AppEnv>,
  agent: ReturnType<typeof createTextingAgentService>,
) {
  app.get("/v1/texting/agent", requireHuman, async (c) =>
    c.json(
      await agent.status(
        c.get("principal"),
        c.req.query("beforeRun") ? idSchema.parse(c.req.query("beforeRun")) : undefined,
      ),
    ),
  );
  app.put("/v1/texting/agent", requireHuman, async (c) =>
    c.json(await agent.configure(c.get("principal"), await parseBody(c, z.unknown()))),
  );
  app.post("/v1/texting/agent/runs/:id/recover", requireHuman, async (c) =>
    c.json(
      await agent.recover(
        c.get("principal"),
        idSchema.parse(c.req.param("id")),
        await parseBody(c, z.unknown()),
      ),
    ),
  );
  for (const action of ["claim", "checkpoint", "reply"] as const) {
    app.post(`/v1/texting/agent/runs/:id/${action}`, async (c) =>
      c.json(
        await agent[action](
          c.get("principal"),
          idSchema.parse(c.req.param("id")),
          await parseBody(c, z.unknown()),
        ),
      ),
    );
  }
}
