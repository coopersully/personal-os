import { idSchema } from "@personal-os/domain";
import type { Hono } from "hono";
import { z } from "zod";
import type { createAutomationHostService } from "../automation-host-service.js";
import type { AppEnv } from "../types.js";
import { parseBody, requireFeatureAccess, requireScope } from "./support.js";

export function registerAutomationHostRoutes({
  app,
  hosts,
}: {
  app: Hono<AppEnv>;
  hosts: ReturnType<typeof createAutomationHostService>;
}) {
  app.use("/v1/automation-hosts/*", async (c, next) => {
    if (c.req.path.endsWith("/observe") || c.req.path.endsWith("/continuations"))
      return requireScope("finances:maintain")(c, next);
    return requireFeatureAccess("finances")(c, next);
  });
  app.use("/v1/automation-hosts", requireFeatureAccess("finances"));
  const id = (value: string) => idSchema.parse(value);
  app.get("/v1/automation-hosts/:id/continuations", requireScope("finances:maintain"), async (c) =>
    c.json(
      await hosts.continuations(
        c.get("principal"),
        id(c.req.param("id")),
        c.req.query("cursor") ? id(c.req.query("cursor") ?? "") : undefined,
      ),
    ),
  );
  app.get("/v1/automation-hosts/answers", async (c) =>
    c.json(
      await hosts.pendingAnswers(
        c.get("principal"),
        c.req.query("cursor") ? id(c.req.query("cursor") ?? "") : undefined,
      ),
    ),
  );
  app.post("/v1/automation-hosts/answers/:id/bind", async (c) => {
    const input = await parseBody(c, z.object({ scheduleId: idSchema }).strict());
    return c.json(
      await hosts.bindAnswer(c.get("principal"), id(c.req.param("id")), input.scheduleId),
    );
  });
  app.get("/v1/automation-hosts/runs", async (c) =>
    c.json(await hosts.hostRuns(c.get("principal"))),
  );
  app.post("/v1/automation-hosts/runs/:id/recover", async (c) =>
    c.json(
      await hosts.recoverHostRun(
        c.get("principal"),
        id(c.req.param("id")),
        await parseBody(c, z.unknown()),
      ),
    ),
  );
  app.post("/v1/automation-hosts/answers/:id/reconcile", async (c) =>
    c.json(
      await hosts.reconcileDelivery(
        c.get("principal"),
        id(c.req.param("id")),
        await parseBody(c, z.unknown()),
      ),
    ),
  );
  app.get("/v1/automation-hosts/connections", async (c) =>
    c.json(await hosts.connections(c.get("principal"))),
  );
  app.get("/v1/automation-hosts", async (c) => c.json(await hosts.list(c.get("principal"))));
  app.post("/v1/automation-hosts", async (c) =>
    c.json(await hosts.create(c.get("principal"), await parseBody(c, z.unknown()))),
  );
  app.post("/v1/automation-hosts/:id/bind", async (c) =>
    c.json(
      await hosts.bind(c.get("principal"), id(c.req.param("id")), await parseBody(c, z.unknown())),
    ),
  );
  app.post("/v1/automation-hosts/:id/observe", requireScope("finances:maintain"), async (c) =>
    c.json(
      await hosts.observe(
        c.get("principal"),
        id(c.req.param("id")),
        await parseBody(c, z.unknown()),
      ),
    ),
  );
  app.patch("/v1/automation-hosts/:id", async (c) =>
    c.json(
      await hosts.update(
        c.get("principal"),
        id(c.req.param("id")),
        await parseBody(c, z.unknown()),
      ),
    ),
  );
  app.post("/v1/automation-hosts/:id/cancel", async (c) =>
    c.json(
      await hosts.cancel(
        c.get("principal"),
        id(c.req.param("id")),
        await parseBody(c, z.unknown()),
      ),
    ),
  );
  app.post("/v1/automation-hosts/:id/revoke", async (c) =>
    c.json(
      await hosts.revoke(
        c.get("principal"),
        id(c.req.param("id")),
        await parseBody(c, z.unknown()),
      ),
    ),
  );
  app.put("/v1/automation-hosts/:id/fire-token", async (c) => {
    const input = await parseBody(
      c,
      z.object({ token: z.string().min(1).max(550), expectedVersion: z.int().positive() }).strict(),
    );
    return c.json(
      await hosts.saveFireToken(
        c.get("principal"),
        id(c.req.param("id")),
        input.token,
        input.expectedVersion,
      ),
    );
  });
}
