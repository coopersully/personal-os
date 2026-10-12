import type { McpServer } from "@modelcontextprotocol/server";
import type { PersonalOsApiClient } from "@personal-os/api-client";
import {
  automationHostScheduleBindInputSchema,
  automationHostScheduleCancelInputSchema,
  automationHostScheduleCreateInputSchema,
  automationHostScheduleRevokeInputSchema,
  automationHostScheduleUpdateInputSchema,
  idSchema,
} from "@personal-os/domain";
import { z } from "zod";
import { apiResult } from "../tool-result.js";

export function registerWorkspaceRecoveryTools(server: McpServer, api: PersonalOsApiClient) {
  server.registerTool(
    "list_automation_host_connections",
    {
      title: "List automation host connections",
      description:
        "List the caller's active host connection identity and scopes. This never creates or changes credentials. Requires finances:read and finances:maintain.",
      inputSchema: {},
    },
    async () => apiResult(() => api.listAutomationHostConnections()),
  );
  server.registerTool(
    "list_automation_host_schedules",
    {
      title: "List automation host schedules",
      description:
        "List schedule metadata bound to this original host connection, including health and version. External hosts own actual scheduling. Requires finances:read and finances:maintain.",
      inputSchema: {},
    },
    async () => apiResult(() => api.listAutomationHostSchedules()),
  );
  server.registerTool(
    "create_automation_host_schedule",
    {
      title: "Create automation host schedule",
      description:
        "Register metadata for an externally managed schedule using this caller's existing connection and a subset of its scopes. Does not schedule the external host. Requires finances:read and finances:maintain. Agent mutations also require finances:write, finances:execute and enabled review bypass.",
      inputSchema: automationHostScheduleCreateInputSchema,
    },
    async (input) => apiResult(() => api.createAutomationHostSchedule(input)),
  );
  server.registerTool(
    "bind_automation_host_schedule",
    {
      title: "Bind automation host schedule",
      description:
        "Bind an existing external automation ID to this connection's pending schedule. Check the external host first. Requires finances:read and finances:maintain. Agent mutations also require finances:write, finances:execute and enabled review bypass.",
      inputSchema: z.discriminatedUnion("hostSurface", [
        automationHostScheduleBindInputSchema.options[0].safeExtend({ scheduleId: idSchema }),
        automationHostScheduleBindInputSchema.options[1].safeExtend({ scheduleId: idSchema }),
      ]),
    },
    async ({ scheduleId, ...input }) =>
      apiResult(() => api.bindAutomationHostSchedule(scheduleId, input)),
  );
  server.registerTool(
    "update_automation_host_schedule",
    {
      title: "Update automation host schedule",
      description:
        "Update the label for the exact observed schedule version. Does not modify external cadence. Requires finances:read and finances:maintain. Agent mutations also require finances:write, finances:execute and enabled review bypass.",
      inputSchema: automationHostScheduleUpdateInputSchema.safeExtend({ scheduleId: idSchema }),
    },
    async ({ scheduleId, ...input }) =>
      apiResult(() => api.updateAutomationHostSchedule(scheduleId, input)),
  );
  server.registerTool(
    "cancel_automation_host_schedule",
    {
      title: "Cancel automation host schedule",
      description:
        "Record cancellation of this connection's schedule using its current state and version. External cancellation remains host-owned. Requires finances:read and finances:maintain. Agent mutations also require finances:write, finances:execute and enabled review bypass.",
      inputSchema: automationHostScheduleCancelInputSchema.safeExtend({ scheduleId: idSchema }),
    },
    async ({ scheduleId, ...input }) =>
      apiResult(() => api.cancelAutomationHostSchedule(scheduleId, input)),
  );
  server.registerTool(
    "revoke_automation_host_schedule",
    {
      title: "Revoke automation host schedule",
      description:
        "Revoke this schedule's local execution binding and stored fire credentials. This does not revoke the agent token. Requires finances:read and finances:maintain. Agent mutations also require finances:write, finances:execute and enabled review bypass.",
      inputSchema: automationHostScheduleRevokeInputSchema.safeExtend({ scheduleId: idSchema }),
    },
    async ({ scheduleId, ...input }) =>
      apiResult(() => api.revokeAutomationHostSchedule(scheduleId, input)),
  );
  server.registerTool(
    "list_finance_host_runs",
    {
      title: "List finance host runs",
      description:
        "List bounded recoverable Finance runs from this original connection. A different same-owner connection cannot take over the run. Requires finances:read and finances:maintain.",
      inputSchema: {},
    },
    async () => apiResult(() => api.listFinanceHostRuns()),
  );
  server.registerTool(
    "list_finance_answer_continuations",
    {
      title: "List finance answer continuations",
      description:
        "Read one bounded page of answers bound to this original host connection. Pass nextCursor unchanged; unbound answers require owner assignment. Requires finances:read and finances:maintain.",
      inputSchema: { cursor: idSchema.optional() },
    },
    async ({ cursor }) => apiResult(() => api.getFinanceAnswerContinuationPage(cursor)),
  );
  server.registerTool(
    "bind_finance_answer_continuation",
    {
      title: "Bind finance answer continuation",
      description:
        "Rebind an already assigned pending answer within its original connection. Requires finances:read, finances:maintain, finances:write, finances:execute and review bypass. Cannot claim an unbound or other-connection answer.",
      inputSchema: { continuationId: idSchema, scheduleId: idSchema },
    },
    async ({ continuationId, scheduleId }) =>
      apiResult(() => api.bindFinanceAnswerContinuation(continuationId, scheduleId)),
  );
  server.registerTool(
    "recover_finance_host_run",
    {
      title: "Recover finance host run",
      description:
        "Rebind an idle recoverable run to an active polling schedule within the original connection. First inspect the external host and current run; hostChecked must reflect actual verification. Requires finances:read, finances:maintain, finances:write, finances:execute and review bypass.",
      inputSchema: {
        runId: idSchema,
        scheduleId: idSchema,
        expectedScheduleId: idSchema,
        expectedConnectionId: idSchema,
        expectedUpdatedAt: z.iso.datetime(),
        hostChecked: z.literal(true),
      },
    },
    async ({ runId, ...input }) => apiResult(() => api.recoverFinanceHostRun(runId, input)),
  );
  server.registerTool(
    "reconcile_finance_host_delivery",
    {
      title: "Reconcile finance host delivery",
      description:
        "Mark an uncertain external delivery unavailable only after checking the host. Requires the original connection, exact updatedAt, finances:read, finances:maintain, finances:write, finances:execute and review bypass. This does not dispatch another delivery.",
      inputSchema: {
        continuationId: idSchema,
        expectedUpdatedAt: z.iso.datetime(),
        hostChecked: z.literal(true),
      },
    },
    async ({ continuationId, ...input }) =>
      apiResult(() => api.reconcileFinanceHostDelivery(continuationId, input)),
  );
}
