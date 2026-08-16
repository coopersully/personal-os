import { type McpServer, ResourceTemplate } from "@modelcontextprotocol/server";
import type { PersonalOsApiClient } from "@personal-os/api-client";
import {
  type AccessScope,
  assistantDomainSchema,
  assistantSetupStepIdSchema,
} from "@personal-os/domain";
import { z } from "zod";
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
        "Call this first. Identify the Ilo user, local time, setup readiness, granted capabilities, available tools, safe workflow stages, and links back to the Ilo work surface.",
      inputSchema: z.object({}),
      title: "Orient to Ilo",
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
            "commit: perform an authorized mutation through Ilo's API",
            "verify: confirm the result from authoritative state or activity",
            "recover: use Ilo's reversible state and recovery links when needed",
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
        "Authenticated identity, local time, readiness, granted scopes, available MCP tools, and Ilo work-surface links.",
      mimeType: "application/json",
      title: "Ilo context",
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
        "One self-contained Ilo setup step, including evidence, instructions, required capabilities, and the human approval boundary.",
      mimeType: "application/json",
      title: "Ilo setup step",
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
          "The user's operative or draft guidance for one Ilo domain. Draft guidance is never execution authority.",
        mimeType: "application/json",
        title: "Ilo domain guidance",
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

  server.registerResource(
    "ilo-agent-work-surface",
    "ui://ilo/work-surface",
    {
      description:
        "A compact visual work surface for Ilo context, previews, approvals, and verification results.",
      mimeType: "text/html;profile=mcp-app",
      title: "Ilo agent work surface",
    },
    async (uri) => ({
      contents: [
        {
          _meta: { ui: { prefersBorder: true } },
          mimeType: "text/html;profile=mcp-app",
          text: iloWorkSurfaceHtml,
          uri: uri.href,
        },
      ],
    }),
  );

  registerPrompts(server, options.scopes);
}

function registerPrompts(server: McpServer, scopes: ReadonlySet<AccessScope>): void {
  const prompts = [
    {
      description: "Orient to Ilo, then continue the next incomplete setup step.",
      name: "set_up_ilo",
      text: "Call get_ilo_context, then get_ilo_setup. Follow only the returned current step, verify its evidence, and stop at any human approval boundary.",
      title: "Set up Ilo",
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
      text: "Call get_ilo_context and get_finance_status. State data freshness and uncertainty. When the caller intends maintenance and has finances:write, invoke maintain_finances once; Ilo keeps questions and approvals pending rather than guessing.",
      title: "Review finances",
    },
    {
      description: "Run a cross-domain weekly review grounded in Ilo's current state.",
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

const iloWorkSurfaceHtml = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
:root{color-scheme:light dark;font:14px/1.45 Inter,ui-sans-serif,system-ui,sans-serif;--bg:#f7f7f5;--card:#fff;--ink:#20201e;--muted:#706f6a;--line:#deddd8;--accent:#2f6fed}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink)}main{padding:18px}.eyebrow{margin:0 0 8px;color:var(--muted);font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase}.card{border:1px solid var(--line);border-radius:16px;background:var(--card);padding:18px;box-shadow:0 1px 2px #0000000a}h1{font-size:20px;line-height:1.2;margin:0 0 6px}.summary{color:var(--muted);margin:0 0 16px}.meta{display:flex;gap:8px;flex-wrap:wrap;margin:0 0 16px}.pill{border:1px solid var(--line);border-radius:999px;padding:4px 9px;color:var(--muted);font-size:12px}pre{margin:0;max-height:360px;overflow:auto;white-space:pre-wrap;word-break:break-word;border-top:1px solid var(--line);padding-top:14px;font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace}@media(prefers-color-scheme:dark){:root{--bg:#171716;--card:#222220;--ink:#f3f2ee;--muted:#aaa8a1;--line:#3a3935;--accent:#8aafff}}
</style></head><body><main><p class="eyebrow">ilo · agent work surface</p><section class="card"><h1 id="title">Ready for an Ilo result</h1><p class="summary" id="summary">Context, previews, and verification will appear here.</p><div class="meta" id="meta"></div><pre id="result">Waiting for a tool result…</pre></section></main>
<script>
const title=document.querySelector('#title'),summary=document.querySelector('#summary'),meta=document.querySelector('#meta'),result=document.querySelector('#result');
function render(payload){const data=payload?.structuredContent??payload?.params?.structuredContent??payload?.params?.result?.structuredContent??payload;const ilo=data?._ilo;if(!data||typeof data!=='object')return;title.textContent=ilo?.domain?ilo.domain[0].toUpperCase()+ilo.domain.slice(1):'Ilo result';summary.textContent=ilo?.stage?('Workflow stage: '+ilo.stage):'Grounded in Ilo’s authenticated state.';meta.replaceChildren();for(const value of [ilo?.policy,ilo?.readOnly?'read only':null].filter(Boolean)){const chip=document.createElement('span');chip.className='pill';chip.textContent=value.replaceAll('_',' ');meta.append(chip)}result.textContent=JSON.stringify(data.result??data.error??data,null,2)}
const initId='ilo-'+(crypto.randomUUID?.()??String(Date.now()));let initialized=false;
function send(message){parent.postMessage(message,'*')}
function applyHostContext(context){if(context?.theme)document.documentElement.style.colorScheme=context.theme}
function reportSize(){if(!initialized)return;send({jsonrpc:'2.0',method:'ui/notifications/size-changed',params:{height:document.documentElement.scrollHeight,width:document.documentElement.scrollWidth}})}
addEventListener('message',event=>{if(event.source!==parent)return;const message=event.data;if(!message||message.jsonrpc!=='2.0')return;if(message.id===initId&&message.result){initialized=true;applyHostContext(message.result.hostContext);send({jsonrpc:'2.0',method:'ui/notifications/initialized',params:{}});reportSize();return}if(message.method==='ui/notifications/tool-result'){render(message.params);return}if(message.method==='ui/notifications/host-context-changed'){applyHostContext(message.params);return}if(message.method==='ui/resource-teardown'&&message.id!==undefined){send({id:message.id,jsonrpc:'2.0',result:{}})}});
new ResizeObserver(()=>requestAnimationFrame(reportSize)).observe(document.documentElement);
send({id:initId,jsonrpc:'2.0',method:'ui/initialize',params:{appCapabilities:{availableDisplayModes:['inline']},appInfo:{name:'ilo-work-surface',title:'Ilo agent work surface',version:'0.1.0'},protocolVersion:'2026-01-26'}});
</script></body></html>`;
