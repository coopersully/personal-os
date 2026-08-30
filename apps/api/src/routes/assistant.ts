import {
  type AgentConnectionGuide,
  type AssistantDomain,
  agentAccessWorkItemQuerySchema,
  assistantDomainSchema,
  assistantSetupPlanQuerySchema,
  attentionItemQuerySchema,
  createAttentionItemInputSchema,
  featureAccessPolicies,
  financeGuidedPreferencesSchema,
  updateAttentionItemInputSchema,
  upsertDomainProfileInputSchema,
  upsertMailProfileInputSchema,
} from "@personal-os/domain";
import type { Context, Hono } from "hono";
import type { createAgentAccessWorkItemService } from "../agent-access-work-items.js";
import type { createAssistantService } from "../assistant-service.js";
import { AppError } from "../errors.js";
import type { AppEnv, Principal } from "../types.js";
import { parseBody } from "./support.js";

type MutationContext = { principal: Principal; requestId: string };

type AssistantRouteOptions = {
  connectionGuide: AgentConnectionGuide;
  app: Hono<AppEnv>;
  assistant: ReturnType<typeof createAssistantService>;
  mutationContext: (context: Context<AppEnv>) => MutationContext;
  workItems: ReturnType<typeof createAgentAccessWorkItemService>;
};

export function registerAssistantRoutes({
  app,
  assistant,
  connectionGuide,
  mutationContext,
  workItems,
}: AssistantRouteOptions) {
  app.get("/v1/assistant/connection-guide", (context) => context.json({ guide: connectionGuide }));
  app.get("/v1/assistant/context", async (context) =>
    context.json({ context: await assistant.getContext(context.get("principal")) }),
  );
  app.get("/v1/assistant/setup-status", async (context) =>
    context.json({ setup: await assistant.getSetupStatus(context.get("principal")) }),
  );
  app.get("/v1/assistant/setup-plan", async (context) =>
    context.json({
      plan: await assistant.getSetupPlan(
        context.get("principal"),
        assistantSetupPlanQuerySchema.parse(context.req.query()),
      ),
    }),
  );
  app.get("/v1/assistant/work-items", async (context) =>
    context.json(
      await workItems.list(
        context.get("principal"),
        agentAccessWorkItemQuerySchema.parse(context.req.query()),
        connectionGuide.domains,
      ),
    ),
  );
  app.get("/v1/assistant/profiles/:domain", async (context) => {
    const domain = assistantDomainSchema.parse(context.req.param("domain"));
    assertDomainAccess(context.get("principal"), domain, false);
    return context.json({
      profile: await assistant.getProfile(context.get("principal").userId, domain),
    });
  });
  app.put("/v1/assistant/profiles/:domain", async (context) => {
    const domain = assistantDomainSchema.parse(context.req.param("domain"));
    assertDomainAccess(context.get("principal"), domain, true);
    const input =
      domain === "mail"
        ? await parseBody(context, upsertMailProfileInputSchema)
        : await parseBody(context, upsertDomainProfileInputSchema);
    if (input.domain !== domain) {
      throw new AppError("invalid_request", "The profile domain must match the request path.");
    }
    if (domain === "finances") financeGuidedPreferencesSchema.parse(input.preferences);
    return context.json({
      profile: await assistant.upsertProfile(input, mutationContext(context)),
    });
  });
  app.get("/v1/assistant/attention", async (context) => {
    const query = attentionItemQuerySchema.parse(context.req.query());
    assertDomainAccess(context.get("principal"), query.domain, false);
    return context.json({
      items: await assistant.listAttentionItems(context.get("principal").userId, query),
    });
  });
  app.post("/v1/assistant/attention", async (context) => {
    const input = await parseBody(context, createAttentionItemInputSchema);
    assertDomainAccess(context.get("principal"), input.domain, true);
    return context.json(
      { item: await assistant.createAttentionItem(input, mutationContext(context)) },
      201,
    );
  });
  app.patch("/v1/assistant/attention/:domain/:id", async (context) => {
    const domain = assistantDomainSchema.parse(context.req.param("domain"));
    assertDomainAccess(context.get("principal"), domain, true);
    return context.json({
      item: await assistant.updateAttentionItem(
        domain,
        context.req.param("id"),
        await parseBody(context, updateAttentionItemInputSchema),
        mutationContext(context),
      ),
    });
  });
}

function assertDomainAccess(principal: Principal, domain: AssistantDomain, write: boolean): void {
  const access = featureAccessPolicies[domain];
  const scope = write ? access.writeScope : access.readScope;
  if (!principal.scopes.has(scope)) {
    throw new AppError("forbidden", `This token requires the ${scope} scope.`);
  }
}
