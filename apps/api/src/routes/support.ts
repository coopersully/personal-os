import {
  type AccessScope,
  type AgentMutationPolicy,
  type FeatureAccessPolicyId,
  featureAccessPolicies,
} from "@personal-os/domain";
import type { Context, MiddlewareHandler } from "hono";
import type { z } from "zod";
import type { ClientMetadata } from "../auth-service.js";
import { AppError } from "../errors.js";
import type { AppEnv } from "../types.js";

/** Shared route helpers. Feature route modules consume these; they do not
 * duplicate request parsing or authorization behavior. */
export async function parseBody<T>(context: Context, schema: z.ZodType<T>): Promise<T> {
  let value: unknown;
  try {
    value = await context.req.json();
  } catch {
    throw new AppError("invalid_request", "The request body must be valid JSON.");
  }
  return schema.parse(value);
}

export function requestMetadata(context: Context, trustProxy = false): ClientMetadata {
  return {
    ipAddress: requestIp(context, trustProxy),
    userAgent: context.req.header("user-agent") ?? null,
  };
}

export function requestIp(context: Context, trustProxy = false): string | null {
  if (!trustProxy) return null;
  return context.req.header("x-forwarded-for")?.split(",")[0]?.trim() || null;
}

export function requireScope(scope: AccessScope): MiddlewareHandler<AppEnv> {
  return async (context, next) => {
    if (!context.get("principal").scopes.has(scope)) {
      throw new AppError("forbidden", `This token requires the ${scope} scope.`);
    }
    await next();
  };
}

/** Apply a domain's shared read/write scopes and agent mutation policy. */
export function requireFeatureAccess(feature: FeatureAccessPolicyId): MiddlewareHandler<AppEnv> {
  const policy = featureAccessPolicies[feature];
  return async (context, next) => {
    const isRead = context.req.method === "GET";
    const scope = isRead ? policy.readScope : policy.writeScope;
    if (!context.get("principal").scopes.has(scope)) {
      throw new AppError("forbidden", `This token requires the ${scope} scope.`);
    }
    assertAgentMutationAllowed(context.get("principal").actorType, isRead, policy.mutationPolicy);
    await next();
  };
}

/** Enforce the product's policy distinction without coupling domain contracts to Hono. */
export function assertAgentMutationAllowed(
  actorType: AppEnv["Variables"]["principal"]["actorType"],
  isRead: boolean,
  mutationPolicy: AgentMutationPolicy,
): void {
  if (!isRead && actorType === "agent" && mutationPolicy !== "approved_rule") {
    throw new AppError("forbidden", "This action requires interactive approval.");
  }
}

export const requireHuman: MiddlewareHandler<AppEnv> = async (context, next) => {
  if (context.get("principal").actorType !== "user") {
    throw new AppError("forbidden", "This operation requires an interactive user session.");
  }
  await next();
};
