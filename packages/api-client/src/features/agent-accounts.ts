import type { AgentAccount, AgentAccountDirectory, AgentPlatform } from "@personal-os/domain";

type Request = <T>(path: string, init?: RequestInit) => Promise<T>;
export function createAgentAccountApi(request: Request) {
  return {
    listAgentAccounts: () => request<AgentAccountDirectory>("/v1/agent-accounts"),
    getCurrentAgentAccount: () => request<AgentAccount | null>("/v1/agent-accounts/current"),
    registerCurrentAgentAccount: (input: { platform?: AgentPlatform } = {}) =>
      request<AgentAccount>("/v1/agent-accounts/current", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    updateAgentAccount: (
      id: string,
      input: { displayName?: string; accountLabel?: string | null; platform?: AgentPlatform },
    ) =>
      request<AgentAccount>(`/v1/agent-accounts/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify(input),
      }),
    linkAgentAccountConnection: (
      id: string,
      input: { agentAccountId: string | null; platform?: AgentPlatform },
    ) =>
      request<AgentAccount>(`/v1/agent-accounts/connections/${encodeURIComponent(id)}`, {
        method: "PUT",
        body: JSON.stringify(input),
      }),
  };
}
