import type { McpServer } from "@modelcontextprotocol/server";
import type { FinancePresentationKind } from "@personal-os/domain";

export const financePresentationResourceUris = {
  finance_budget: "ui://ilo/finances/budget",
  finance_period_verification: "ui://ilo/finances/period-verification",
  finance_review: "ui://ilo/finances/review",
  finance_snapshot: "ui://ilo/finances/snapshot",
} as const satisfies Record<FinancePresentationKind, `ui://ilo/${string}`>;

const presentationTitles = {
  finance_budget: "Finance budget",
  finance_period_verification: "Finance period verification",
  finance_review: "Finance review",
  finance_snapshot: "Financial snapshot",
} as const satisfies Record<FinancePresentationKind, string>;

export const financePresentationDocuments = Object.fromEntries(
  (Object.keys(financePresentationResourceUris) as FinancePresentationKind[]).map((kind) => [
    kind,
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${presentationTitles[kind]}</title></head><body><main><p>This result is available in chat.</p></main></body></html>`,
  ]),
) as Record<FinancePresentationKind, string>;

export function registerFinancePresentationResources(server: McpServer): void {
  for (const kind of Object.keys(financePresentationResourceUris) as FinancePresentationKind[]) {
    const uri = financePresentationResourceUris[kind];
    server.registerResource(
      kind,
      uri,
      {
        description: `A compact, read-only ${presentationTitles[kind]} presentation.`,
        mimeType: "text/html;profile=mcp-app",
        title: presentationTitles[kind],
      },
      async (resourceUri) => ({
        contents: [
          {
            _meta: { ui: { prefersBorder: true } },
            mimeType: "text/html;profile=mcp-app",
            text: financePresentationDocuments[kind],
            uri: resourceUri.href,
          },
        ],
      }),
    );
  }
}
