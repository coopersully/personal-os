import { nativePushDeviceInputSchema } from "@personal-os/domain";
import type { Hono } from "hono";
import { z } from "zod";
import { AppError } from "../errors.js";
import type { createNativePushService } from "../native-push-service.js";
import type { AppEnv } from "../types.js";

export function registerNativePushRoutes(
  app: Hono<AppEnv>,
  service: ReturnType<typeof createNativePushService>,
) {
  app.put("/v1/native-push/devices/:installationId", async (context) => {
    const installationId = z.uuid().parse(context.req.param("installationId"));
    const input = nativePushDeviceInputSchema.parse(await context.req.json());
    if (input.installationId !== installationId)
      throw new AppError("invalid_request", "Device identity does not match.");
    context.header("cache-control", "no-store");
    return context.json(await service.register(context.get("principal"), input));
  });
  app.delete("/v1/native-push/devices/:installationId", async (context) => {
    const installationId = z.uuid().parse(context.req.param("installationId"));
    context.header("cache-control", "no-store");
    return context.json(await service.disable(context.get("principal"), installationId));
  });
  app.get("/v1/native-push/events/:eventId", async (context) => {
    const eventId = z.uuid().parse(context.req.param("eventId"));
    const { installationId } = z
      .object({ installationId: z.uuid() })
      .strict()
      .parse(context.req.query());
    context.header("cache-control", "no-store");
    return context.json(await service.resolve(context.get("principal"), eventId, installationId));
  });
}
