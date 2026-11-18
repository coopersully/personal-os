import {
  financeOnboardingCompleteInputSchema,
  financeOnboardingSaveInputSchema,
} from "@personal-os/domain";
import type { Context, Hono } from "hono";
import { z } from "zod";
import type { FinanceMutationContext } from "../finance/context.js";
import type { createFinanceOnboardingService } from "../finance-onboarding-service.js";
import type { AppEnv } from "../types.js";
import { parseBody, requireScope } from "./support.js";

/** Owner identity and current mutation authority come exclusively from authenticated composition. */
export function registerFinanceOnboardingRoutes({
  app,
  onboarding,
  authorize,
}: {
  app: Hono<AppEnv>;
  onboarding: ReturnType<typeof createFinanceOnboardingService>;
  authorize: (context: Context<AppEnv>) => Promise<FinanceMutationContext>;
}) {
  const root = "/v1/finances/onboarding";
  app.use(root, async (context, next) => {
    context.header("Cache-Control", "no-store");
    await next();
  });
  app.use(`${root}/*`, async (context, next) => {
    context.header("Cache-Control", "no-store");
    await next();
  });
  app.get(root, requireScope("finances:read"), async (context) => {
    z.strictObject({}).parse(context.req.query());
    return context.json(await onboarding.getFinanceOnboarding(context.get("principal").userId));
  });
  app.post(`${root}/answers`, requireScope("finances:write"), async (context) =>
    context.json(
      await onboarding.saveFinanceOnboardingAnswers(
        await parseBody(context, financeOnboardingSaveInputSchema),
        await authorize(context),
      ),
    ),
  );
  app.post(`${root}/complete`, requireScope("finances:write"), async (context) =>
    context.json(
      await onboarding.completeFinanceOnboarding(
        await parseBody(context, financeOnboardingCompleteInputSchema),
        await authorize(context),
      ),
    ),
  );
}
