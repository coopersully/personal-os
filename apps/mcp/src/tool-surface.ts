import type { McpServer } from "@modelcontextprotocol/server";
import type { AccessScope } from "@personal-os/domain";
import { z } from "zod";
import { createPersonalOsAppLinks } from "./app-links.js";
import { financePresentationResourceUris } from "./presentation-resources.js";
import {
  canDiscoverTool,
  type PersonalOsToolDefinition,
  type PersonalOsToolName,
  personalOsToolCatalog,
  personalOsToolPolicies,
  personalOsToolStages,
} from "./tool-catalog.js";

const errorSchema = z.object({
  code: z.union([z.string(), z.number()]).optional(),
  details: z.unknown().optional(),
  message: z.string(),
  requestId: z.string().nullable().optional(),
  status: z.number().optional(),
});

export const personalOsToolOutputSchema = z
  .object({
    _ilo: z.object({
      domain: z.string(),
      links: z.object({
        activity: z.url(),
        agentAccess: z.url(),
        approvals: z.url(),
        recovery: z.url(),
        today: z.url(),
      }),
      policy: z.enum(personalOsToolPolicies),
      readOnly: z.boolean(),
      stage: z.enum(personalOsToolStages),
    }),
    error: errorSchema.optional(),
    ok: z.boolean().optional(),
    result: z.unknown().optional(),
  })
  .catchall(z.unknown());

type ToolRegistrationConfig = {
  _meta?: Record<string, unknown>;
  annotations?: {
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
    readOnlyHint?: boolean;
  };
  description?: string;
  icons?: { mimeType?: string; src: string }[];
  inputSchema?: unknown;
  outputSchema?: unknown;
  title?: string;
};

type ToolCallback = (...args: unknown[]) => Promise<unknown> | unknown;
type RuntimeRegisterTool = (
  name: string,
  config: ToolRegistrationConfig,
  callback: ToolCallback,
) => unknown;

export type PersonalOsToolSurfaceOptions = {
  appBaseUrl: string;
  includeCompatibility: boolean;
  readOnly: boolean;
  scopes: ReadonlySet<AccessScope>;
};

/**
 * Wrap feature-owned registrations with one deterministic discovery and result contract.
 * The proxy is intentionally narrow at runtime: feature modules only call registerTool.
 */
export function createPersonalOsToolSurface(
  server: McpServer,
  options: PersonalOsToolSurfaceOptions,
): McpServer {
  const registerTool = server.registerTool.bind(server) as unknown as RuntimeRegisterTool;

  return new Proxy(server, {
    get(target, property, receiver) {
      if (property !== "registerTool") return Reflect.get(target, property, receiver);

      return (name: string, config: ToolRegistrationConfig, callback: ToolCallback) => {
        const definition = getToolDefinition(name);
        if (
          !canDiscoverTool(
            definition,
            options.scopes,
            options.readOnly,
            options.includeCompatibility,
          )
        )
          return undefined;

        return registerTool(
          name,
          {
            ...config,
            _meta: {
              ...config._meta,
              "ilo/domain": definition.domain,
              "ilo/policy": definition.policy,
              "ilo/stage": definition.stage,
              ...(definition.presentation
                ? { ui: { resourceUri: financePresentationResourceUris[definition.presentation] } }
                : {}),
            },
            annotations: {
              destructiveHint:
                definition.destructive ?? config.annotations?.destructiveHint ?? false,
              idempotentHint:
                definition.idempotent ?? config.annotations?.idempotentHint ?? definition.readOnly,
              openWorldHint: definition.openWorld ?? config.annotations?.openWorldHint ?? false,
              readOnlyHint: definition.readOnly,
            },
            icons: config.icons ?? [
              {
                mimeType: "image/png",
                src: `${options.appBaseUrl}/icon-192.png`,
              },
            ],
            outputSchema: personalOsToolOutputSchema,
          },
          async (...args: unknown[]) => {
            const raw = await callback(...args);
            return attachPersonalOsMetadata(raw, definition, options.appBaseUrl);
          },
        );
      };
    },
  });
}

function getToolDefinition(name: string): PersonalOsToolDefinition {
  const definition = personalOsToolCatalog[name as PersonalOsToolName];
  if (!definition) {
    throw new Error(`MCP tool ${name} is missing from the nohmi tool catalog.`);
  }
  return definition;
}

function attachPersonalOsMetadata(
  raw: unknown,
  definition: PersonalOsToolDefinition,
  appBaseUrl: string,
) {
  if (!raw || typeof raw !== "object") return raw;
  const value = raw as {
    content?: unknown;
    isError?: boolean;
    structuredContent?: Record<string, unknown>;
  };
  return {
    ...value,
    structuredContent: {
      ...value.structuredContent,
      _ilo: {
        domain: definition.domain,
        links: createPersonalOsAppLinks(appBaseUrl, definition.domain),
        policy: definition.policy,
        readOnly: definition.readOnly,
        stage: definition.stage,
      },
    },
  };
}
