import type { AccessScope } from "@personal-os/domain";
import { Hono } from "hono";
import { errorResponse } from "../errors.js";
import type { createFinanceActivityService } from "../finance/activity-service.js";
import type { AppEnv, Principal } from "../types.js";
import { registerFinanceActivityRoutes } from "./finance-activity.js";

const owner = "11111111-1111-4111-8111-111111111111";

describe("human Finance Activity route", () => {
  function fixture() {
    const app = new Hono<AppEnv>();
    let principal: Principal = {
      userId: owner,
      actorId: owner,
      actorType: "user",
      scopes: new Set<AccessScope>(["finances:read"]),
    };
    const listActivity = vi.fn(async () => ({ entries: [], nextCursor: null }));
    const readEvidence = vi.fn(async () => ({ entryId: owner, changes: [], nextCursor: null }));
    app.use("*", async (context, next) => {
      context.set("principal", principal);
      context.set("requestId", "activity-read");
      await next();
    });
    app.onError(errorResponse);
    registerFinanceActivityRoutes({
      app,
      activity: { listActivity, readEvidence } as unknown as ReturnType<
        typeof createFinanceActivityService
      >,
    });
    return {
      app,
      listActivity,
      readEvidence,
      setPrincipal: (value: Principal) => {
        principal = value;
      },
      principal,
    };
  }
  it("passes authenticated owner and bounded filters with no private caching", async () => {
    const f = fixture();
    const response = await f.app.request(
      `/v1/finances/activity?limit=10&type=human_answer_decision&actor=user&recordId=${owner}`,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(f.listActivity).toHaveBeenCalledWith(owner, {
      limit: 10,
      type: "human_answer_decision",
      actor: "user",
      recordId: owner,
    });
    expect((await f.app.request("/v1/finances/activity?userId=foreign")).status).toBe(400);
    expect(f.listActivity).toHaveBeenCalledTimes(1);
  });
  it("keeps paginated evidence human-only and owner-bound without private caching", async () => {
    const f = fixture();
    const response = await f.app.request(
      `/v1/finances/activity/${owner}/evidence?cursor=signed-cursor`,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(f.readEvidence).toHaveBeenCalledWith(owner, owner, { cursor: "signed-cursor" });
    expect(
      (await f.app.request(`/v1/finances/activity/${owner}/evidence?owner=foreign`)).status,
    ).toBe(400);
    f.setPrincipal({ ...f.principal, actorType: "agent" });
    expect((await f.app.request(`/v1/finances/activity/${owner}/evidence`)).status).toBe(403);
    expect(f.readEvidence).toHaveBeenCalledTimes(1);
  });
  it("blocks agents even with Finance scopes so source messages cannot bypass fixed-run intake", async () => {
    const f = fixture();
    f.setPrincipal({
      ...f.principal,
      actorType: "agent",
      scopes: new Set(["finances:read", "finances:maintain", "finances:write", "finances:execute"]),
    });
    expect((await f.app.request("/v1/finances/activity")).status).toBe(403);
    expect(f.listActivity).not.toHaveBeenCalled();
    f.setPrincipal({ ...f.principal, scopes: new Set() });
    expect((await f.app.request("/v1/finances/activity")).status).toBe(403);
    expect(f.listActivity).not.toHaveBeenCalled();
  });
});
