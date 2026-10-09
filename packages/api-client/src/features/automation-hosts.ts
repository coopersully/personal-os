import type {
  AccessScope,
  AutomationHostSchedule,
  AutomationHostScheduleBindInput,
  AutomationHostScheduleCancelInput,
  AutomationHostScheduleCreateInput,
  AutomationHostScheduleHealth,
  AutomationHostScheduleObservationInput,
  AutomationHostScheduleRevokeInput,
  AutomationHostScheduleUpdateInput,
} from "@personal-os/domain";

type Request = <T>(path: string, init?: RequestInit) => Promise<T>;
export type HostScheduleStatus = {
  schedule: AutomationHostSchedule;
  health: AutomationHostScheduleHealth;
  connectionAvailable?: boolean;
};
export type FinanceContinuation = {
  id: string;
  state: "pending" | "accepted" | "completed" | "unavailable";
  maintenanceRunId: string | null;
  answer?: { text: string; sourceKind: "app" | "agent" | "sms" } | null;
};
export function createAutomationHostApi(request: Request) {
  const path = (id: string) => `/v1/automation-hosts/${encodeURIComponent(id)}`;
  return {
    listAutomationHostConnections: () =>
      request<{ id: string; label: string; scopes: AccessScope[] }[]>(
        "/v1/automation-hosts/connections",
      ),
    listAutomationHostSchedules: () => request<HostScheduleStatus[]>("/v1/automation-hosts"),
    createAutomationHostSchedule: (input: AutomationHostScheduleCreateInput) =>
      request<HostScheduleStatus>("/v1/automation-hosts", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    bindAutomationHostSchedule: (id: string, input: AutomationHostScheduleBindInput) =>
      request<HostScheduleStatus>(`${path(id)}/bind`, {
        method: "POST",
        body: JSON.stringify(input),
      }),
    observeAutomationHostSchedule: (id: string, input: AutomationHostScheduleObservationInput) =>
      request<HostScheduleStatus>(`${path(id)}/observe`, {
        method: "POST",
        body: JSON.stringify(input),
      }),
    updateAutomationHostSchedule: (id: string, input: AutomationHostScheduleUpdateInput) =>
      request<HostScheduleStatus>(path(id), { method: "PATCH", body: JSON.stringify(input) }),
    cancelAutomationHostSchedule: (id: string, input: AutomationHostScheduleCancelInput) =>
      request<HostScheduleStatus>(`${path(id)}/cancel`, {
        method: "POST",
        body: JSON.stringify(input),
      }),
    revokeAutomationHostSchedule: (id: string, input: AutomationHostScheduleRevokeInput) =>
      request<HostScheduleStatus>(`${path(id)}/revoke`, {
        method: "POST",
        body: JSON.stringify(input),
      }),
    saveAutomationHostFireToken: (id: string, input: { token: string; expectedVersion: number }) =>
      request<HostScheduleStatus>(`${path(id)}/fire-token`, {
        method: "PUT",
        body: JSON.stringify(input),
      }),
    listFinanceAnswerContinuations: async () => {
      type Answer = FinanceContinuation & {
        reviewCaseId: string;
        updatedAt: string;
        automationScheduleId: string | null;
        fireState: "pending" | "submitting" | "accepted" | "uncertain" | "unavailable";
      };
      const answers: Answer[] = [];
      const cursors = new Set<string>();
      let cursor: string | null = null;
      do {
        const page: { continuations: Answer[]; nextCursor: string | null } = await request(
          `/v1/automation-hosts/answers${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`,
        );
        answers.push(...page.continuations);
        cursor = page.nextCursor;
        if (cursor) {
          if (cursors.has(cursor)) throw new Error("The Finance answer cursor did not advance.");
          cursors.add(cursor);
        }
      } while (cursor);
      return answers;
    },
    bindFinanceAnswerContinuation: (id: string, scheduleId: string) =>
      request<{ id: string }>(`/v1/automation-hosts/answers/${encodeURIComponent(id)}/bind`, {
        method: "POST",
        body: JSON.stringify({ scheduleId }),
      }),
    listFinanceHostRuns: () =>
      request<
        {
          id: string;
          status: string;
          automationScheduleId: string;
          authorizationConnectionId: string;
          updatedAt: string;
        }[]
      >("/v1/automation-hosts/runs"),
    recoverFinanceHostRun: (
      id: string,
      input: {
        scheduleId: string;
        expectedScheduleId: string;
        expectedConnectionId: string;
        expectedUpdatedAt: string;
        hostChecked: true;
      },
    ) =>
      request<{ id: string }>(`/v1/automation-hosts/runs/${encodeURIComponent(id)}/recover`, {
        method: "POST",
        body: JSON.stringify(input),
      }),
    reconcileFinanceHostDelivery: (
      id: string,
      input: { expectedUpdatedAt: string; hostChecked: true },
    ) =>
      request<{ id: string }>(`/v1/automation-hosts/answers/${encodeURIComponent(id)}/reconcile`, {
        method: "POST",
        body: JSON.stringify(input),
      }),
    getFinanceContinuations: (id: string, cursor?: string) =>
      request<
        HostScheduleStatus & {
          continuations: FinanceContinuation[];
          hasMore: boolean;
          nextCursor: string | null;
        }
      >(`${path(id)}/continuations${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`),
  };
}
