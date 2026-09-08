import { type McpServer, ResourceTemplate } from "@modelcontextprotocol/server";
import type { PersonalOsApiClient } from "@personal-os/api-client";
import {
  type AccessScope,
  assistantDomainSchema,
  assistantSetupStepIdSchema,
} from "@personal-os/domain";
import { z } from "zod";
import { registerFinancePresentationResources } from "./presentation-resources.js";
import { availableToolNames } from "./tool-catalog.js";
import { apiResult } from "./tool-result.js";

type DiscoveryOptions = {
  api: PersonalOsApiClient;
  appBaseUrl: string;
  includeCompatibility: boolean;
  now: () => Date;
  readOnly: boolean;
  scopes: ReadonlySet<AccessScope>;
  timeZone: string;
};

export function registerIloContextTool(server: McpServer, options: DiscoveryOptions): void {
  server.registerTool(
    "get_ilo_context",
    {
      description:
        "Call this first. Identify the Nomi user, local time, setup readiness, granted capabilities, available tools, safe workflow stages, and links back to the Nomi work surface.",
      inputSchema: z.object({}),
      title: "Orient to Nomi",
    },
    async () =>
      apiResult(async () => ({
        ...(await options.api.getIloContext()),
        mcp: {
          availableTools: availableToolNames(
            options.scopes,
            options.readOnly,
            options.includeCompatibility,
          ),
          readOnly: options.readOnly,
          workflow: [
            "context: orient to the user, time, readiness, and granted access",
            "inspect: read current state and source evidence",
            "prepare: preview a proposed change without committing it",
            "commit: perform an authorized mutation through Nomi's API",
            "verify: confirm the result from authoritative state or activity",
            "recover: use Nomi's reversible state and recovery links when needed",
          ],
        },
      })),
  );
}

export function registerIloDiscovery(server: McpServer, options: DiscoveryOptions): void {
  server.registerResource(
    "ilo-context",
    "ilo://context/self",
    {
      description:
        "Authenticated identity, local time, readiness, granted scopes, available MCP tools, and Nomi work-surface links.",
      mimeType: "application/json",
      title: "Nomi context",
    },
    async (uri) => ({
      contents: [
        {
          mimeType: "application/json",
          text: JSON.stringify(
            {
              ...(await options.api.getIloContext()),
              mcp: {
                availableTools: availableToolNames(
                  options.scopes,
                  options.readOnly,
                  options.includeCompatibility,
                ),
                readOnly: options.readOnly,
              },
            },
            null,
            2,
          ),
          uri: uri.href,
        },
      ],
    }),
  );

  server.registerResource(
    "ilo-setup-step",
    new ResourceTemplate("ilo://setup/{domain}/{step}", {
      complete: {
        domain: (value) =>
          assistantDomainSchema.options.filter((domain) => domain.startsWith(value)),
      },
      list: undefined,
    }),
    {
      description:
        "One self-contained Nomi setup step, including evidence, instructions, required capabilities, and the human approval boundary.",
      mimeType: "application/json",
      title: "Nomi setup step",
    },
    async (uri, variables) => {
      const domain = assistantDomainSchema.parse(variables.domain);
      const stepId = assistantSetupStepIdSchema.parse(variables.step);
      return {
        contents: [
          {
            mimeType: "application/json",
            text: JSON.stringify(await options.api.getIloSetup({ domain, stepId }), null, 2),
            uri: uri.href,
          },
        ],
      };
    },
  );

  if ([...options.scopes].some((scope) => scope.endsWith(":read"))) {
    server.registerResource(
      "ilo-guidance",
      new ResourceTemplate("ilo://guidance/{domain}", {
        complete: {
          domain: (value) =>
            assistantDomainSchema.options.filter((domain) => domain.startsWith(value)),
        },
        list: undefined,
      }),
      {
        description:
          "The user's operative or draft guidance for one Nomi domain. Draft guidance is never execution authority.",
        mimeType: "application/json",
        title: "Nomi domain guidance",
      },
      async (uri, variables) => {
        const domain = assistantDomainSchema.parse(variables.domain);
        return {
          contents: [
            {
              mimeType: "application/json",
              text: JSON.stringify(await options.api.getDomainProfile(domain), null, 2),
              uri: uri.href,
            },
          ],
        };
      },
    );
  }

  if (options.scopes.has("finances:read")) registerFinancePresentationResources(server);

  registerPrompts(server, options);
}

function registerPrompts(
  server: McpServer,
  options: Pick<DiscoveryOptions, "includeCompatibility" | "readOnly" | "scopes">,
): void {
  const scopes = options.scopes;
  const canMaintainFinances =
    !options.readOnly &&
    availableToolNames(options.scopes, options.readOnly, options.includeCompatibility).includes(
      "maintain_finances",
    );
  const prompts = [
    {
      description: "Orient to Nomi, then continue the next incomplete setup step.",
      name: "set_up_ilo",
      text: "Call get_ilo_context, then get_ilo_setup. Follow only the returned current step, verify its evidence, and stop at any human approval boundary.",
      title: "Set up Nomi",
    },
    {
      description: "Build a grounded plan for today without silently changing commitments.",
      name: "plan_today",
      text: "Call get_ilo_context and get_daily_brief. Inspect tasks, reminders, and calendar only where available. Separate facts from recommendations and preview changes before committing them.",
      title: "Plan today",
    },
    {
      description: "Review mail using the user's approved guidance and preview-first rules.",
      name: "triage_mail",
      text: "Call get_ilo_context, get_mail_setup_context, and get_domain_profile for mail. Inspect the mailbox, preview any rule or bulk action, explain its evidence, and commit only with the required authority.",
      title: "Triage mail",
    },
    {
      description: "Prepare a calendar commitment with conflict and evidence checks.",
      name: "prepare_calendar_commitment",
      text: "Call get_ilo_context, inspect the relevant calendars and events, then call preview_calendar_commitment. Present conflicts, assumptions, and source evidence before creating or changing an event.",
      title: "Prepare a calendar commitment",
    },
    {
      description: "Review overdue reminders and propose a defensible deferral plan.",
      name: "review_overdue_reminders",
      text: "Call get_ilo_context, list overdue reminders, and preview_overdue_reminder_deferral. Explain the proposed schedule and do not update reminders until authorized.",
      title: "Review overdue reminders",
    },
    {
      description: "Review finances with freshness, source, and reconciliation context.",
      name: "review_finances",
      text: canMaintainFinances
        ? "Call get_ilo_context and get_finance_status. State data freshness and uncertainty. When the caller intends maintenance, invoke maintain_finances once; Nomi keeps questions and approvals pending rather than guessing."
        : "Call get_ilo_context and get_finance_status. State data freshness and uncertainty. Present pending work and stop after status; questions and approvals remain pending rather than guessed.",
      title: "Review finances",
    },
    {
      description: "Run a cross-domain weekly review grounded in Nomi's current state.",
      name: "weekly_review",
      text: "Call get_ilo_context, inspect goals, tasks, reminders, calendar, attention items, and finances where granted. Summarize evidence first, then propose a small set of reversible next actions.",
      title: "Weekly review",
    },
  ] as const;

  const canRead = (scope: AccessScope) => scopes.has(scope);
  const visible = (name: (typeof prompts)[number]["name"]) =>
    name === "set_up_ilo" ||
    (name === "plan_today" && canRead("automations:read")) ||
    (name === "triage_mail" && canRead("mail:read")) ||
    (name === "prepare_calendar_commitment" && canRead("calendar:read")) ||
    (name === "review_overdue_reminders" && canRead("reminders:read")) ||
    (name === "review_finances" && canRead("finances:read")) ||
    (name === "weekly_review" && [...scopes].some((scope) => scope.endsWith(":read")));

  for (const prompt of prompts.filter((prompt) => visible(prompt.name))) {
    server.registerPrompt(
      prompt.name,
      { description: prompt.description, title: prompt.title },
      () => ({
        messages: [
          { content: { text: prompt.text, type: "text" as const }, role: "user" as const },
        ],
      }),
    );
  }
}
