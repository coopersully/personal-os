import { randomUUID } from "node:crypto";
import { createApiClient } from "@personal-os/api-client";
import type { Page } from "@playwright/test";

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
      return new Response(await response.text(), {
        status: response.status(),
        headers: response.headers(),
      });
    },
  });
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
    isError?: boolean;
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
