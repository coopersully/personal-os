import { financeSpendingQuerySchema } from "@personal-os/domain";
import type { Hono } from "hono";
import { AppError } from "../errors.js";
import type { createFinanceSpendingService } from "../finance/spending-service.js";
import type { AppEnv } from "../types.js";
import { requireFeatureAccess, requireScope } from "./support.js";

/** Finance read route; service owner comes exclusively from the authenticated principal. */
export function registerFinanceSpendingRoute(input: {
  app: Hono<AppEnv>;
  spending?: ReturnType<typeof createFinanceSpendingService> | undefined;
}) {
  input.app.get(
    "/v1/finances/spending",
    requireFeatureAccess("finances"),
    requireScope("finances:read"),
    async (context) => {
      const selection = (key: string) => {
        const mode = context.req.query(`${key}Selection`);
        if (mode === "none") return [];
        if (mode === "all" || (mode === undefined && context.req.queries(key) === undefined))
          return null;
        if (mode !== undefined && mode !== "selected")
          throw new AppError("invalid_request", "Invalid spending selection.");
        return (context.req.queries(key) ?? []).map((id) =>
          key === "categoryIds" && id === "uncategorized" ? null : id,
        );
      };
      const boolean = (key: string, fallback: boolean) => {
        const raw = context.req.query(key);
        if (raw === undefined) return fallback;
        if (raw !== "true" && raw !== "false")
          throw new AppError("invalid_request", "Invalid spending option.");
        return raw === "true";
      };
      const query = financeSpendingQuerySchema.parse({
        scope: {
          from: context.req.query("from"),
          through: context.req.query("through"),
          timezone: context.req.query("timezone"),
          accountIds: selection("accountIds"),
          categoryIds: selection("categoryIds"),
          basis: context.req.query("basis") ?? "personal_cost",
          includePending: boolean("includePending", true),
          subtractRefunds: boolean("subtractRefunds", true),
        },
        grouping: context.req.query("grouping"),
        includeUncategorized: boolean("includeUncategorized", true),
      });
      if (!input.spending) throw new AppError("service_unavailable", "Spending is unavailable.");
      context.header("Cache-Control", "no-store");
      return context.json({
        spending: await input.spending.readSpending(context.get("principal").userId, query),
      });
    },
  );
}
