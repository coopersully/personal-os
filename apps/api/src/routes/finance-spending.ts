import {
  type FinanceTransaction,
  financeSpendingQuerySchema,
  financeSpendingReferenceFilterSchema,
} from "@personal-os/domain";
import type { Hono } from "hono";
import { z } from "zod";
import { AppError } from "../errors.js";
import type { createFinanceSpendingService } from "../finance/spending-service.js";
import { selectFinanceSpendingReferences } from "../finance/spending-service.js";
import type { AppEnv } from "../types.js";
import { parseBody, requireFeatureAccess, requireScope } from "./support.js";

/** Finance read route; service owner comes exclusively from the authenticated principal. */
export function registerFinanceSpendingRoute(input: {
  app: Hono<AppEnv>;
  spending?: ReturnType<typeof createFinanceSpendingService> | undefined;
  readTransaction?:
    | ((userId: string, id: string) => Promise<{ data: FinanceTransaction }>)
    | undefined;
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
  input.app.post(
    "/v1/finances/spending/transactions",
    requireScope("finances:read"),
    async (context) => {
      const body = await parseBody(
        context,
        z
          .object({
            filter: financeSpendingReferenceFilterSchema,
            cursor: z.string().max(100).optional(),
            limit: z.number().int().min(1).max(100).default(50),
          })
          .strict(),
      );
      if (!input.spending || !input.readTransaction)
        throw new AppError("service_unavailable", "Spending transaction detail is unavailable.");
      const readTransaction = input.readTransaction;
      const owner = context.get("principal").userId;
      const dashboard = await input.spending.readSpending(owner, body.filter.query);
      const selection = selectFinanceSpendingReferences(
        dashboard,
        body.filter,
        body.cursor,
        body.limit,
      );
      const items = await Promise.all(
        selection.transactionIds.map(async (id) => {
          const row = (await readTransaction(owner, id)).data;
          const source = dashboard.transactions.find((item) => item.id === id);
          if (
            !source?.updatedAt ||
            row.updatedAt !== source.updatedAt ||
            row.accountId !== source.accountId
          )
            throw new AppError(
              "conflict",
              "A transaction changed while loading. Return to Spending and reopen this selection.",
            );
          return row;
        }),
      );
      const { transactionIds: _ids, ...result } = selection;
      context.header("Cache-Control", "no-store");
      return context.json({ ...result, items });
    },
  );
}
