import { Hono } from "hono";
import { errorResponse } from "../errors.js";
import type { TextingRecoveryClaim } from "../texting-recovery-service.js";
import type { AppEnv, Principal } from "../types.js";
import { registerTextingRecoveryRoutes } from "./texting-recovery.js";

const inboundMessageId = "11111111-1111-4111-8111-111111111111";
const userId = "22222222-2222-4222-8222-222222222222";
const path = `/v1/texting/finance-replies/${inboundMessageId}/status`;

function fixture() {
  const principal: Principal = {
    userId,
    actorId: userId,
    actorType: "user",
    scopes: new Set(["texting:read", "finances:read"]),
  };
  const internal: TextingRecoveryClaim = {
    inboundMessageId,
    state: "attached",
    reason: null,
    children: [
      {
        itemNumber: 1,
        bindingId: "33333333-3333-4333-8333-333333333333",
        operationId: "44444444-4444-4444-8444-444444444444",
        state: "accepted",
        reason: null,
        terminal: true,
      },
      {
        itemNumber: 2,
        bindingId: "55555555-5555-4555-8555-555555555555",
        operationId: "66666666-6666-4666-8666-666666666666",
        state: "uncertain",
        reason: "private-finance-receipt-detail",
        terminal: false,
      },
    ],
  };
  const inspectClaim = vi.fn(
    async (_owner: string, _message: string) => internal as TextingRecoveryClaim | null,
  );
  const runPage = vi.fn();
  const app = new Hono<AppEnv>();
  app.onError(errorResponse);
  app.use("*", async (context, next) => {
    context.set("principal", principal);
    context.set("requestId", "request");
    await next();
  });
  const recovery = { inspectClaim, runPage };
  registerTextingRecoveryRoutes({ app, recovery });
  return { app, principal, inspectClaim, runPage, internal };
}

describe("exact Finance SMS reply status route", () => {
  it("requires both read scopes before touching owner status for users and agents", async () => {
    const { app, principal, inspectClaim } = fixture();
    for (const actorType of ["user", "agent"] as const) {
      principal.actorType = actorType;
      for (const scopes of [[], ["texting:read"], ["finances:read"]] as const) {
        principal.scopes = new Set(scopes);
        expect((await app.request(path)).status).toBe(403);
      }
    }
    expect(inspectClaim).not.toHaveBeenCalled();
    principal.scopes = new Set(["texting:read", "finances:read"]);
    expect((await app.request(path)).status).toBe(200);
    expect(inspectClaim).toHaveBeenCalledWith(userId, inboundMessageId);
  });

  it("returns indistinguishable 404s for absent and foreign claims", async () => {
    const { app, inspectClaim } = fixture();
    inspectClaim.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
    const absent = await app.request(path);
    const foreign = await app.request(path);
    expect(absent.status).toBe(404);
    expect(foreign.status).toBe(404);
    expect(await absent.json()).toEqual(await foreign.json());
  });

  it("projects a finite redacted status and never invokes maintenance", async () => {
    const { app, inspectClaim, runPage, internal } = fixture();
    const response = await app.request(path);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      inboundMessageId,
      state: "attached",
      reasonCode: null,
      children: [
        { itemNumber: 1, state: "accepted", reasonCode: null, terminal: true },
        { itemNumber: 2, state: "uncertain", reasonCode: "processing_uncertain", terminal: false },
      ],
      reviewHref: "/settings?section=reviews",
    });
    for (const secret of ["bindingId", "operationId", "private-finance-receipt-detail"])
      expect(JSON.stringify(body)).not.toContain(secret);
    expect(internal.children).toHaveLength(2);
    expect(inspectClaim).toHaveBeenCalledTimes(1);
    expect(runPage).not.toHaveBeenCalled();
    expect((await app.request(path, { method: "POST" })).status).toBe(404);
  });
});
