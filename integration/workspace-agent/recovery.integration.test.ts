import {
  auditEvents,
  financeAnswerContinuations,
  workspaceMaintenanceRuns,
} from "@personal-os/database";
import { eq, sql } from "drizzle-orm";
import { createMcpWorkspaceFixture, type WorkspaceFixture } from "./fixture.js";

describe("connection-bound host controls", () => {
  let f: WorkspaceFixture;
  beforeAll(async () => {
    f = await createMcpWorkspaceFixture();
  }, 120_000);
  afterAll(async () => {
    await f?.close();
  });
  it("manages only the caller's existing host connection", async () => {
    await f.setBypass(true);
    const scopes = [
      "finances:read",
      "finances:write",
      "finances:execute",
      "finances:maintain",
    ] as const;
    const a = await f.connectAgent([...scopes]);
    const b = await f.connectAgent([...scopes]);
    async function call(name: string, args: Record<string, unknown> = {}) {
      const r = await a.client.callTool({ name, arguments: args });
      expect(r.isError, JSON.stringify(r)).not.toBe(true);
      return (r.structuredContent as { result: unknown }).result;
    }
    const connections = (await call("list_automation_host_connections")) as { id: string }[];
    expect(connections).toHaveLength(1);
    const created = (await call("create_automation_host_schedule", {
      label: "MCP test host",
      hostSurface: "codex_desktop",
      tenantAuthorizationConnectionId: connections[0]?.id,
      requestedScopes: ["finances:read", "finances:maintain"],
      trigger: {
        type: "recurring",
        recurrence: { type: "interval", everyMinutes: 60, timeZone: "America/New_York" },
      },
    })) as { schedule: { id: string; version: number } };
    const alien = await b.client.callTool({
      name: "update_automation_host_schedule",
      arguments: {
        scheduleId: created.schedule.id,
        expectedVersion: created.schedule.version,
        label: "Stolen",
      },
    });
    expect(alien.isError).toBe(true);
    const updated = (await call("update_automation_host_schedule", {
      scheduleId: created.schedule.id,
      expectedVersion: created.schedule.version,
      label: "Renamed",
    })) as { schedule: { version: number } };
    expect(await call("list_automation_host_schedules")).toEqual([
      expect.objectContaining({
        schedule: expect.objectContaining({ id: created.schedule.id, label: "Renamed" }),
      }),
    ]);
    await f.setBypass(false);
    const denied = await a.client.callTool({
      name: "cancel_automation_host_schedule",
      arguments: {
        scheduleId: created.schedule.id,
        expectedVersion: updated.schedule.version,
        expectedState: "setup_pending",
      },
    });
    expect(denied.isError).toBe(true);
    expect(JSON.stringify(denied)).toContain("bypass");
    await f.setBypass(true);
    const cancelled = await call("cancel_automation_host_schedule", {
      scheduleId: created.schedule.id,
      expectedVersion: updated.schedule.version,
      expectedState: "setup_pending",
    });
    expect(cancelled).toMatchObject({ schedule: { state: "cancelled" } });
    const scheduleAudit = await f.db.query.auditEvents.findMany({
      where: eq(auditEvents.entityId, created.schedule.id),
    });
    expect(scheduleAudit).toHaveLength(3);
    expect(
      scheduleAudit.every(
        (event) => event.actorType === "agent" && event.actorId === a.credential.id,
      ),
    ).toBe(true);
    expect(scheduleAudit).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          before: expect.objectContaining({ state: "setup_pending" }),
          after: expect.objectContaining({ state: "cancelled" }),
        }),
      ]),
    );
    const second = (await call("create_automation_host_schedule", {
      label: "Bind fixture",
      hostSurface: "codex_desktop",
      tenantAuthorizationConnectionId: connections[0]?.id,
      requestedScopes: ["finances:read", "finances:maintain"],
      trigger: {
        type: "recurring",
        recurrence: { type: "interval", everyMinutes: 60, timeZone: "America/New_York" },
      },
    })) as { schedule: { id: string; version: number } };
    const bound = (await call("bind_automation_host_schedule", {
      scheduleId: second.schedule.id,
      expectedVersion: second.schedule.version,
      expectedState: "setup_pending",
      hostSurface: "codex_desktop",
      hostAutomationId: "controlled-host",
      nextExpectedAt: "2026-10-11T16:00:00Z",
    })) as { schedule: { version: number } };
    const continuations = await call("get_finance_continuations", {
      scheduleId: second.schedule.id,
    });
    expect(JSON.stringify(continuations)).toContain(second.schedule.id);
    const observed = (await call("observe_finance_host_schedule", {
      scheduleId: second.schedule.id,
      observation: {
        expectedVersion: bound.schedule.version,
        expectedState: "active",
        hostSurface: "codex_desktop",
        observedState: "active",
        observedAt: "2026-10-11T15:00:00Z",
        nextExpectedAt: "2026-10-11T16:00:00Z",
      },
    })) as { schedule: { version: number } };
    // Seed a lost controlled-host delivery; recovery must retain its original connection.
    const [answer] = await f.db
      .insert(financeAnswerContinuations)
      .values({
        userId: f.owner.id,
        operationId: crypto.randomUUID(),
        reviewCaseId: crypto.randomUUID(),
        transactionId: crypto.randomUUID(),
        resultingWorkRevision: 1n,
        automationScheduleId: second.schedule.id,
        fireState: "uncertain",
        updatedAt: new Date("2026-10-11T14:00:00Z"),
      })
      .returning();
    const deniedRecovery = await b.client.callTool({
      name: "reconcile_finance_host_delivery",
      arguments: {
        continuationId: answer!.id,
        expectedUpdatedAt: answer!.updatedAt.toISOString(),
        hostChecked: true,
      },
    });
    expect(deniedRecovery.isError).toBe(true);
    await call("reconcile_finance_host_delivery", {
      continuationId: answer!.id,
      expectedUpdatedAt: answer!.updatedAt.toISOString(),
      hostChecked: true,
    });
    await call("bind_finance_answer_continuation", {
      continuationId: answer!.id,
      scheduleId: second.schedule.id,
    });
    expect(
      await f.db.query.financeAnswerContinuations.findFirst({
        where: eq(financeAnswerContinuations.id, answer!.id),
      }),
    ).toMatchObject({ fireState: "pending", automationScheduleId: second.schedule.id });
    expect(
      await f.db.query.auditEvents.findMany({ where: eq(auditEvents.entityId, answer!.id) }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "finance.host_answer.bound",
          actorId: a.credential.id,
          actorType: "agent",
        }),
      ]),
    );
    // A concurrent owner assignment must take precedence over stale agent ownership.
    const otherConnections = await b.api.listAutomationHostConnections();
    const otherSchedule = await b.api.createAutomationHostSchedule({
      label: "Other connection",
      hostSurface: "codex_desktop",
      tenantAuthorizationConnectionId: otherConnections[0]!.id,
      requestedScopes: ["finances:read", "finances:maintain"],
      trigger: {
        type: "recurring",
        recurrence: { type: "interval", everyMinutes: 60, timeZone: "America/New_York" },
      },
    });
    let release!: () => void;
    let ready!: () => void;
    const held = new Promise<void>((r) => {
      release = r;
    });
    const acquired = new Promise<void>((r) => {
      ready = r;
    });
    const ownerRebind = f.db.transaction(async (tx) => {
      await tx
        .select()
        .from(financeAnswerContinuations)
        .where(eq(financeAnswerContinuations.id, answer!.id))
        .for("update");
      ready();
      await held;
      await tx
        .update(financeAnswerContinuations)
        .set({ automationScheduleId: otherSchedule.schedule.id })
        .where(eq(financeAnswerContinuations.id, answer!.id));
    });
    await acquired;
    const agentRebind = a.client.callTool({
      name: "bind_finance_answer_continuation",
      arguments: { continuationId: answer!.id, scheduleId: second.schedule.id },
    });
    try {
      let waiting = false;
      for (let attempt = 0; attempt < 100; attempt++) {
        const rows = await f.db.execute(
          sql`select pid from pg_stat_activity where wait_event_type='Lock' and query like '%finance_answer_continuations%' and pid <> pg_backend_pid()`,
        );
        if (rows.rows.length) {
          waiting = true;
          break;
        }
        await new Promise((r) => setTimeout(r, 20));
      }
      expect(waiting).toBe(true);
    } finally {
      release();
      await ownerRebind;
    }
    expect((await agentRebind).isError).toBe(true);
    expect(
      await f.db.query.financeAnswerContinuations.findFirst({
        where: eq(financeAnswerContinuations.id, answer!.id),
      }),
    ).toMatchObject({ automationScheduleId: otherSchedule.schedule.id });
    const [run] = await f.db
      .insert(workspaceMaintenanceRuns)
      .values({
        userId: f.owner.id,
        domain: "finances",
        scope: { type: "all_outstanding" },
        rulebookVersion: "fixture",
        status: "awaiting_agent_challenge",
        automationScheduleId: created.schedule.id,
        authorizationConnectionId: connections[0]!.id,
        checkpoint: { retained: "evidence" },
      })
      .returning();
    await call("recover_finance_host_run", {
      runId: run!.id,
      scheduleId: second.schedule.id,
      expectedScheduleId: created.schedule.id,
      expectedConnectionId: connections[0]!.id,
      expectedUpdatedAt: run!.updatedAt.toISOString(),
      hostChecked: true,
    });
    expect(
      await f.db.query.workspaceMaintenanceRuns.findFirst({
        where: eq(workspaceMaintenanceRuns.id, run!.id),
      }),
    ).toMatchObject({
      automationScheduleId: second.schedule.id,
      checkpoint: { retained: "evidence" },
      status: "awaiting_agent_challenge",
    });
    const revoked = await call("revoke_automation_host_schedule", {
      scheduleId: second.schedule.id,
      expectedVersion: observed.schedule.version,
      expectedState: "active",
    });
    expect(revoked).toMatchObject({ schedule: { state: "revoked" } });
  });
});
