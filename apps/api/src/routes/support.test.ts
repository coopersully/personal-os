import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { AppError } from "../errors.js";
import type { Principal } from "../types.js";
import { assertAgentMutationAllowed, parseOptionalBody, requireFeatureAccess } from "./support.js";

function principal(
  scopes: Principal["scopes"],
  actorType: Principal["actorType"] = "agent",
): Principal {
  return { actorId: "actor", actorType, scopes, userId: "user" };
}

describe("agent mutation policy", () => {
  it("parses optional JSON bodies consistently", async () => {
    const schema = z.object({ expectedUpdatedAt: z.string().optional() });
    await expect(
      parseOptionalBody({ req: { text: async () => "" } } as never, schema),
    ).resolves.toEqual({});
    await expect(
      parseOptionalBody(
        { req: { text: async () => '{"expectedUpdatedAt":"revision"}' } } as never,
        schema,
      ),
    ).resolves.toEqual({ expectedUpdatedAt: "revision" });
    await expect(
      parseOptionalBody({ req: { text: async () => "{" } } as never, schema),
    ).rejects.toMatchObject({ code: "invalid_request" });
  });

  it("allows a scoped agent to run a bounded approved rule", () => {
    expect(() => assertAgentMutationAllowed("agent", false, "approved_rule")).not.toThrow();
  });

  it("allows read-only requests and human mutations without an agent rule", () => {
    expect(() => assertAgentMutationAllowed("agent", true, "read_only")).not.toThrow();
    expect(() => assertAgentMutationAllowed("user", false, "approve_each")).not.toThrow();
  });

  it("requires interactive approval for agent mutations outside an approved rule", () => {
    expect(() => assertAgentMutationAllowed("agent", false, "approve_each")).toThrow(AppError);
  });

  it("selects read and write scopes from the shared feature policy", async () => {
    const next = vi.fn();
    const readContext = {
      get: () => principal(new Set(["tasks:read"])),
      req: { method: "GET" },
    };
    await requireFeatureAccess("tasks")(readContext as never, next);
    expect(next).toHaveBeenCalledOnce();

    await requireFeatureAccess("tasks")(
      {
        get: () => principal(new Set(["tasks:write"])),
        req: { method: "POST" },
      } as never,
      next,
    );
    expect(next).toHaveBeenCalledTimes(2);
  });

  it("rejects a request that lacks the feature's selected scope", async () => {
    await expect(
      requireFeatureAccess("reminders")(
        {
          get: () => principal(new Set(["reminders:read"])),
          req: { method: "POST" },
        } as never,
        vi.fn(),
      ),
    ).rejects.toBeInstanceOf(AppError);
  });
});
