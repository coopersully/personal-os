import type { CreateTaskInput, Task, TaskListQuery, UpdateTaskInput } from "@personal-os/domain";

export type TaskApiRequest = <T>(path: string, init?: RequestInit) => Promise<T>;

/** Typed task operations sharing the authenticated client transport. */
export function createTaskApiClient(request: TaskApiRequest, toQuery: (query: object) => string) {
  return {
    async completeTask(id: string, completed: boolean): Promise<Task> {
      const response = await request<{ task: Task }>(`/v1/tasks/${id}/complete`, {
        body: JSON.stringify({ completed }),
        method: "POST",
      });
      return response.task;
    },
    async createTask(input: CreateTaskInput): Promise<Task> {
      const response = await request<{ task: Task }>("/v1/tasks", {
        body: JSON.stringify(input),
        method: "POST",
      });
      return response.task;
    },
    async deleteTask(id: string): Promise<void> {
      await request<void>(`/v1/tasks/${id}`, { method: "DELETE" });
    },
    async listTasks(query: Partial<TaskListQuery> = {}): Promise<{
      items: Task[];
      nextCursor: string | null;
    }> {
      return request(`/v1/tasks?${toQuery(query)}`);
    },
    async restoreTask(id: string): Promise<Task> {
      const response = await request<{ task: Task }>(`/v1/tasks/${id}/restore`, {
        method: "POST",
      });
      return response.task;
    },
    async updateTask(id: string, input: UpdateTaskInput): Promise<Task> {
      const response = await request<{ task: Task }>(`/v1/tasks/${id}`, {
        body: JSON.stringify(input),
        method: "PATCH",
      });
      return response.task;
    },
  };
}
