import { randomUUID } from "node:crypto";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { createApiClient } from "@personal-os/api-client";
import type { Page } from "@playwright/test";
import { createPersonalOsMcpServer } from "../apps/mcp/src/server.js";

export type FinanceSetupHuman = ReturnType<typeof createApiClient>;

/** Real public HTTP transport using the browser context's authenticated cookies. */
export function browserFinanceHuman(page: Page, baseURL: string): FinanceSetupHuman {
  return createApiClient({
    baseUrl: baseURL,
    fetch: async (input, init) => {
      const response = await page.request.fetch(String(input), {
        method: init?.method ?? "GET",
        headers: Object.fromEntries(new Headers(init?.headers)),
        ...(typeof init?.body === "string" ? { data: init.body } : {}),
      });
      return new Response(response.status() === 204 ? null : await response.text(), {
        status: response.status(),
        headers: response.headers(),
      });
    },
  });
}

/** Public API authorization + real SDK protocol over linked transports.
 * This is not a public MCP HTTP transport or external scheduler smoke test.
 */
export async function createFinanceSetupHost(human: FinanceSetupHuman, baseURL: string) {
  const origin = new URL(baseURL);
  if (!["127.0.0.1", "localhost", "[::1]"].includes(origin.hostname))
    throw new Error("Finance host browser fixtures require a disposable loopback runtime");
  const originalPolicy = await human.getExecutionPolicySettings();
  const credential = await human.createAccessToken({
    name: "Disposable Finance setup original host",
    scopes: ["finances:read", "finances:maintain", "finances:write", "finances:execute"],
  });
  const agent = createApiClient({ baseUrl: baseURL, token: credential.token });
  let scheduleId: string | undefined;
  let revoked = false;
  let server: ReturnType<typeof createPersonalOsMcpServer> | undefined;
  let client: Client | undefined;
  const revokeOriginalToken = async () => {
    if (!revoked) {
      await human.deleteAccessToken(credential.id);
      revoked = true;
    }
  };
  const close = async () => {
    const outcomes = await Promise.allSettled([
      (async () => {
        if (!scheduleId) return;
        const current = (await human.listAutomationHostSchedules()).find(
          (item) => item.schedule.id === scheduleId,
        )?.schedule;
        if (current?.state === "setup_pending")
          await human.cancelAutomationHostSchedule(current.id, {
            expectedVersion: current.version,
            expectedState: "setup_pending",
          });
        else if (current?.state === "active" || current?.state === "paused")
          await human.revokeAutomationHostSchedule(current.id, {
            expectedVersion: current.version,
            expectedState: current.state,
          });
      })(),
      client?.close(),
      server?.close(),
    ]);
    const remaining = await Promise.allSettled([
      revokeOriginalToken(),
      (async () => {
        const current = await human.getExecutionPolicySettings();
        if (current.reviewBypassEnabled !== originalPolicy.reviewBypassEnabled)
          await human.updateExecutionPolicySettings({
            expectedVersion: current.version,
            reviewBypassEnabled: originalPolicy.reviewBypassEnabled,
          });
      })(),
    ]);
    const failures = [...outcomes, ...remaining].filter((outcome) => outcome.status === "rejected");
    if (failures.length)
      throw new AggregateError(
        failures.map((outcome) => outcome.reason),
        "Host fixture cleanup failed",
      );
  };
  try {
    const context = await agent.getPersonalOsContext();
    await human.updateExecutionPolicySettings({
      expectedVersion: originalPolicy.version,
      reviewBypassEnabled: true,
    });
    const connections = await agent.listAutomationHostConnections();
    if (connections.length !== 1 || !connections[0])
      throw new Error("Expected exactly the new token's original authorization connection");
    const connection = connections[0];
    const created = await agent.createAutomationHostSchedule({
      tenantAuthorizationConnectionId: connection.id,
      label: "Disposable local Finance setup host",
      requestedScopes: ["finances:maintain"],
      hostSurface: "codex_desktop",
      trigger: {
        type: "recurring",
        recurrence: {
          type: "interval",
          everyMinutes: 5,
          timeZone: "America/New_York",
        },
      },
    });
    scheduleId = created.schedule.id;
    // Controlled fixture binding only: no native scheduler is created or fired.
    await agent.bindAutomationHostSchedule(scheduleId, {
      expectedVersion: created.schedule.version,
      expectedState: "setup_pending",
      hostSurface: "codex_desktop",
      hostAutomationId: `browser-fixture-${randomUUID()}`,
      nextExpectedAt: new Date(Date.now() + 5 * 60_000).toISOString(),
    });
    server = createPersonalOsMcpServer({
      api: agent,
      scopes: new Set(context.access.grantedScopes),
      readOnly: false,
      timeZone: "America/New_York",
    });
    client = new Client({ name: "finance-setup-browser-fixture", version: "1" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
    return { agent, client, scheduleId, connectionId: connection.id, revokeOriginalToken, close };
  } catch (error) {
    try {
      await close();
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], "Host fixture setup and cleanup failed");
    }
    throw error;
  }
}

/** Each desktop/mobile attempt gets a new named disposable owner, never a shared catalog mutation. */
export async function createFinanceSetupPersona(page: Page, baseURL: string) {
  const human = browserFinanceHuman(page, baseURL);
  const email = `qa+finance-setup-${randomUUID()}@nohmi.test`;
  await human.register({
    displayName: "Finance setup browser fixture",
    email,
    password: "Testing12345!",
    planningTimezone: "America/New_York",
  });
  // register sets the same HttpOnly session cookie used by the browser app.
  // A fresh client has no captured response token, so this checks cookie auth.
  const cookieOnly = browserFinanceHuman(page, baseURL);
  if ((await cookieOnly.getMe()).email !== email)
    throw new Error("Registration did not establish the browser context session");
  await human.updateAccountSetup({ action: "dismiss" });
  return { human, email };
}

export async function addReviewedManualSource(human: FinanceSetupHuman) {
  const account = await human.createFinanceAccount({
    name: "Setup checking",
    institution: "Disposable fixture bank",
    provider: "manual",
    kind: "cash",
    balance: 1200,
  });
  await human.updateFinanceAccount(account.id, {
    idempotencyKey: randomUUID(),
    ownershipType: "individual",
    ownershipShare: 1,
    includeInPlanning: true,
  });
  return account;
}

/** For composed-runtime fixture preparation after loading records; never grants legacy access. */
export async function completeFinanceSetupViaApi(human: FinanceSetupHuman) {
  let snapshot = await human.getFinanceOnboarding();
  if (snapshot.completedAt) return snapshot;
  if (snapshot.source.state === "ownership_required") {
    const accounts = await human.listFinanceAccounts();
    for (const account of accounts.accounts) {
      await human.updateFinanceAccount(account.id, {
        idempotencyKey: randomUUID(),
        ownershipType: "individual",
        ownershipShare: 1,
        includeInPlanning: true,
      });
    }
    snapshot = await human.getFinanceOnboarding();
  }
  if (snapshot.source.state !== "usable" && snapshot.source.state !== "syncing") {
    throw new Error(`Cannot complete Finance fixture with source ${snapshot.source.state}`);
  }
  const saved = await human.saveFinanceOnboardingAnswers({
    expectedRevision: snapshot.revision,
    idempotencyKey: randomUUID(),
    automationChoice: "later",
    displayPreferencesReviewed: true,
    answers: snapshot.questions.map(({ questionId }) => ({ questionId, disposition: "unknown" })),
  });
  const completed = await human.completeFinanceOnboarding({
    expectedRevision: saved.revision,
    idempotencyKey: randomUUID(),
    automationChoice: "later",
  });
  if (!completed.completedAt) throw new Error("Canonical completion did not confirm completedAt");
  return completed;
}

export interface OriginalAgentMcp {
  callTool(input: { name: string; arguments: Record<string, unknown> }): Promise<{
    isError?: boolean | undefined;
    structuredContent?: unknown;
  }>;
}

/** Requires an already authorized original connection and real bound schedule. No bootstrap bypass. */
export async function verifyFinanceChatThroughOriginalAgent(
  human: FinanceSetupHuman,
  originalAgent: OriginalAgentMcp,
  scheduleId: string,
) {
  const challenge = await human.issueFinanceConversationChallenge(scheduleId);
  async function exchange(operation: Record<string, unknown>) {
    const result = await originalAgent.callTool({
      name: "exchange_finance_conversation_challenge",
      arguments: { challengeId: challenge.challengeId, operation },
    });
    if (result.isError) throw new Error("Original agent rejected actual Finance challenge");
    return (result.structuredContent as { result?: Record<string, unknown> } | undefined)?.result;
  }
  const fetched = await exchange({ kind: "fetch" });
  if (typeof fetched?.nonce !== "string") throw new Error("Actual MCP fetch returned no nonce");
  await exchange({ kind: "acknowledge", challengeId: challenge.challengeId, nonce: fetched.nonce });
  await exchange({
    kind: "respond",
    challengeId: challenge.challengeId,
    response: "Harmless disposable browser fixture verification",
  });
  const readiness = await human.getFinanceConversationHostReadiness(scheduleId);
  if (!readiness.canSend)
    throw new Error("Real challenge did not establish current Chat authority");
  return readiness;
}
