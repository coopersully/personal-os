import type { AccessScope, FinanceOnboardingSnapshot } from "@personal-os/domain";
import { Hono } from "hono";
import { errorResponse } from "../errors.js";
import type { FinanceMutationContext } from "../finance/context.js";
import type { AppEnv, Principal } from "../types.js";
import { registerFinanceOnboardingRoutes } from "./finance-onboarding.js";

const owner = "11111111-1111-4111-8111-111111111111";
const value: FinanceOnboardingSnapshot = {
  revision: 0,
  completedAt: null,
  existingAccess: false,
  source: { state: "missing", summary: "Add a source", recoveryHref: "/finances/accounts" },
  contextReview: "reviewed",
  questions: [],
  displayPreferences: { reviewed: false, summary: [] },
  automationChoice: null,
  manualVisibility: "auto",
  automation: {
    registrationCount: 0,
    authorizedRegistrationWithCadence: false,
    chatVerification: "pending",
    canSendChat: false,
    historyAvailable: true,
  },
};
function fixture(scopes: AccessScope[] = ["finances:read", "finances:write"]) {
  const app = new Hono<AppEnv>();
  const principal: Principal = {
    userId: owner,
    actorId: owner,
    actorType: "user",
    scopes: new Set(scopes),
  };
  const context: FinanceMutationContext = {
    userId: owner,
    actorId: owner,
    actorType: "user",
    requestId: "setup-route",
    canMutate: true,
    canSelfApprove: false,
    bypassEnabled: false,
  };
  const onboarding = {
    getFinanceOnboarding: vi.fn().mockResolvedValue(value),
    saveFinanceOnboardingAnswers: vi.fn().mockResolvedValue({ ...value, revision: 1 }),
    completeFinanceOnboarding: vi.fn().mockResolvedValue({ ...value, revision: 2 }),
  };
  const authorize = vi.fn().mockResolvedValue(context);
  app.use("*", async (c, next) => {
    c.set("principal", principal);
    c.set("requestId", "setup-route");
    await next();
  });
  app.onError(errorResponse);
  registerFinanceOnboardingRoutes({ app, onboarding, authorize });
  return { app, onboarding, authorize, context };
}
function post(body: unknown): RequestInit {
  return {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}
it("reads only authenticated owner state, without caching or caller owner overrides", async () => {
  const f = fixture();
  const response = await f.app.request("/v1/finances/onboarding");
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(f.onboarding.getFinanceOnboarding).toHaveBeenCalledWith(owner);
  expect((await f.app.request("/v1/finances/onboarding?userId=foreign")).status).toBe(400);
  expect(f.onboarding.getFinanceOnboarding).toHaveBeenCalledTimes(1);
});
it("uses current authenticated mutation context and preserves pending completion honestly", async () => {
  const f = fixture();
  const input = { expectedRevision: 1, idempotencyKey: "finish-one", automationChoice: "later" };
  const response = await f.app.request("/v1/finances/onboarding/complete", post(input));
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ revision: 2, completedAt: null });
  expect(f.authorize).toHaveBeenCalledTimes(1);
  expect(f.onboarding.completeFinanceOnboarding).toHaveBeenCalledWith(input, f.context);
});
it("rejects missing read/write scopes and forged identity or duplicate question input before services", async () => {
  const f = fixture([]);
  expect((await f.app.request("/v1/finances/onboarding")).status).toBe(403);
  expect((await f.app.request("/v1/finances/onboarding/complete", post({}))).status).toBe(403);
  expect(f.authorize).not.toHaveBeenCalled();
  expect(f.onboarding.getFinanceOnboarding).not.toHaveBeenCalled();
  const allowed = fixture();
  const input = {
    expectedRevision: 0,
    idempotencyKey: "save-one",
    automationChoice: "later",
    displayPreferencesReviewed: true,
    answers: [{ questionId: "income", disposition: "unknown" }],
  };
  expect(
    (
      await allowed.app.request(
        "/v1/finances/onboarding/answers",
        post({ ...input, userId: "foreign" }),
      )
    ).status,
  ).toBe(400);
  expect(
    (
      await allowed.app.request(
        "/v1/finances/onboarding/answers",
        post({ ...input, answers: [...input.answers, ...input.answers] }),
      )
    ).status,
  ).toBe(400);
  expect(allowed.onboarding.saveFinanceOnboardingAnswers).not.toHaveBeenCalled();
});
