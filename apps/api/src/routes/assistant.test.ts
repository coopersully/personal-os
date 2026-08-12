import { Hono } from "hono";
import type { createAssistantService } from "../assistant-service.js";
import type { AppEnv } from "../types.js";
import { registerAssistantRoutes } from "./assistant.js";

const id = "11111111-1111-4111-8111-111111111111";
const now = "2026-07-28T15:00:00.000Z";
const profile = {
  categories: [],
  createdAt: now,
  domain: "mail" as const,
  id,
  instructions: [],
  objective: "Keep a clean inbox.",
  preferences: {},
  sourceContexts: [],
  status: "draft" as const,
  summary: "A high-signal inbox.",
  updatedAt: now,
  version: 1,
};
const item = {
  createdAt: now,
  domain: "mail" as const,
  expiresAt: null,
  id,
  importance: "normal" as const,
  kind: "important" as const,
  occursAt: null,
  relatedEntityId: null,
  relatedEntityType: null,
  source: null,
  status: "open" as const,
  summary: "Important mail.",
  title: "Important",
  updatedAt: now,
  version: 1,
};

describe("assistant setup routes", () => {
  it("uses the same profile and attention workflow for a scoped domain", async () => {
    const app = new Hono<AppEnv>();
    const assistant = {
      createAttentionItem: vi.fn(async () => item),
      getContext: vi.fn(async () => ({
        access: { grantedScopes: ["mail:read", "mail:write"] },
        generatedAt: now,
        identity: { actorType: "agent" as const, displayName: "Ilo test", userId: id },
        links: {
          activity: "https://app.example.com/activity",
          agentAccess: "https://app.example.com/settings?section=agents",
          approvals: "https://app.example.com/settings?section=agents",
          recovery: "https://app.example.com/settings?section=agents",
          today: "https://app.example.com/today",
        },
        readiness: { domains: [] },
        time: { timestamp: now, timezone: "America/New_York" },
      })),
      getProfile: vi.fn(async () => profile),
      getSetupPlan: vi.fn(async () => ({
        currentStepId: "learn_preferences" as const,
        domain: "mail" as const,
      })),
      getSetupStatus: vi.fn(async () => ({ domains: [] })),
      listAttentionItems: vi.fn(async () => [item]),
      updateAttentionItem: vi.fn(async () => ({ ...item, status: "resolved" as const })),
      upsertProfile: vi.fn(async () => profile),
    };
    app.use("*", async (context, next) => {
      context.set("principal", {
        actorId: id,
        actorType: "agent",
        scopes: new Set(["mail:read", "mail:write"]),
        userId: id,
      });
      context.set("requestId", "request-1");
      await next();
    });
    app.onError((error, context) =>
      context.json({ error: error instanceof Error ? error.message : "unknown" }, 403),
    );
    registerAssistantRoutes({
      app,
      assistant: assistant as unknown as ReturnType<typeof createAssistantService>,
      connectionGuide: {
        domains: [],
        mcpUrl: "https://mcp.example.com/mcp",
        skill: {
          displayName: "Ilo Guided Setup",
          installPrompt: "Install the Ilo skill.",
          invocation: "$ilo-setup",
          name: "ilo-setup",
          revision: "release-0.1.0",
          setupPrompt: "Set up Ilo.",
          sourceUrl: "https://example.com/ilo-setup",
          version: "0.1.0",
        },
      },
      mutationContext: (context) => ({
        principal: context.get("principal"),
        requestId: context.get("requestId"),
      }),
    });
    const json = { headers: { "content-type": "application/json" } };

    expect((await app.request("/v1/assistant/connection-guide")).status).toBe(200);
    expect((await app.request("/v1/assistant/context")).status).toBe(200);
    expect((await app.request("/v1/assistant/setup-status")).status).toBe(200);
    expect(
      (await app.request("/v1/assistant/setup-plan?domain=mail&stepId=learn_preferences")).status,
    ).toBe(200);
    expect(assistant.getSetupPlan).toHaveBeenCalledWith(
      expect.objectContaining({ actorType: "agent", userId: id }),
      { domain: "mail", stepId: "learn_preferences" },
    );
    expect((await app.request("/v1/assistant/profiles/mail")).status).toBe(200);
    expect(
      (
        await app.request("/v1/assistant/profiles/mail", {
          ...json,
          body: JSON.stringify({
            categories: [],
            domain: "mail",
            instructions: [],
            objective: profile.objective,
            preferences: {},
            sourceContexts: [],
            status: "draft",
            summary: profile.summary,
          }),
          method: "PUT",
        })
      ).status,
    ).toBe(200);
    expect((await app.request("/v1/assistant/attention?domain=mail")).status).toBe(200);
    expect(
      (
        await app.request("/v1/assistant/attention", {
          ...json,
          body: JSON.stringify({
            domain: "mail",
            expiresAt: null,
            importance: "normal",
            kind: "important",
            occursAt: null,
            relatedEntityId: null,
            relatedEntityType: null,
            source: null,
            summary: item.summary,
            title: item.title,
          }),
          method: "POST",
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await app.request(`/v1/assistant/attention/mail/${id}`, {
          ...json,
          body: JSON.stringify({ expectedVersion: 1, status: "resolved" }),
          method: "PATCH",
        })
      ).status,
    ).toBe(200);
    expect((await app.request("/v1/assistant/profiles/finances")).status).toBe(403);
    expect(assistant.upsertProfile).toHaveBeenCalledWith(
      expect.objectContaining({ domain: "mail" }),
      expect.objectContaining({ requestId: "request-1" }),
    );
    expect(assistant.getSetupPlan).toHaveBeenCalledWith(
      expect.objectContaining({ actorType: "agent" }),
      { domain: "mail", stepId: "learn_preferences" },
    );
  });
});
