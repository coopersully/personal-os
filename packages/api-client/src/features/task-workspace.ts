import type { TaskWorkspacePage, TaskWorkspaceQuery } from "@personal-os/domain";

export function createTaskWorkspaceApiClient(
  request: <T>(path: string, init?: RequestInit) => Promise<T>,
  toQuery: (query: object) => string,
) {
  return {
    async listTaskWorkspace(query: Partial<TaskWorkspaceQuery> = {}): Promise<TaskWorkspacePage> {
      return request(`/v1/task-workspace?${toQuery(query)}`);
    },
  };
}
