import type { Database } from "@personal-os/database";
import { Hono } from "hono";
import { errorResponse } from "../errors.js";
import { budgetPlanningDate, readBudgetPlanContext } from "./budget-plan-projection.js";

describe("budget plan projection read boundary", () => {
  it("uses wall dates rather than UTC month near midnight and rejects invalid timezones", () => {
    expect(budgetPlanningDate(new Date("2026-11-01T02:30:00Z"), "America/New_York")).toBe(
      "2026-10-31",
    );
    expect(budgetPlanningDate(new Date("2026-11-01T02:30:00Z"), "UTC")).toBe("2026-11-01");
    expect(() => budgetPlanningDate(new Date(), "Invalid/Timezone")).toThrow(
      expect.objectContaining({ code: "service_unavailable" }),
    );
  });
  it("propagates unavailable storage instead of fabricating a missing plan", async () => {
    const error = new Error("storage unavailable");
    const reader = {
      select: () => {
        throw error;
      },
    } as unknown as Pick<Database, "select">;
    await expect(
      readBudgetPlanContext(reader, crypto.randomUUID(), new Date()),
    ).rejects.toMatchObject({ code: "service_unavailable", cause: error });
  });
  it("returns a controlled HTTP unavailable response without disclosing storage internals", async () => {
    const reader = {
      select: () => {
        throw new Error("private SQL source detail");
      },
    } as unknown as Pick<Database, "select">;
    const app = new Hono();
    app.onError(errorResponse);
    app.get("/", async (c) =>
      c.json(await readBudgetPlanContext(reader, crypto.randomUUID(), new Date())),
    );
    const response = await app.request("/");
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.error).toMatchObject({
      code: "service_unavailable",
      details: { recovery: "refresh_plan" },
    });
    expect(JSON.stringify(body)).not.toContain("private SQL");
  });
});
