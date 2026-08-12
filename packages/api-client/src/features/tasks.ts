import type {
  ArchiveTaskListInput,
  ArchiveTaskProjectInput,
  CancelTaskInput,
  CancelTaskProjectInput,
  CompleteTaskInput,
  CompleteTaskProjectInput,
  CreateTaskInput,
  CreateTaskListInput,
  CreateTaskProjectInput,
  MoveTaskInput,
  MoveTaskProjectInput,
  ReopenTaskInput,
  RestoreTaskInput,
  Task,
  TaskList,
  TaskListQuery,
  TaskMovePreview,
  TaskMovePreviewInput,
  TaskProject,
  TaskProjectMovePreview,
  TaskProjectMovePreviewInput,
  TrashTaskInput,
  UpdateTaskInput,
  UpdateTaskListInput,
  UpdateTaskProjectInput,
} from "@personal-os/domain";

export type TaskApiRequest = <T>(path: string, init?: RequestInit) => Promise<T>;

type TaskContainerListQuery = Pick<TaskListQuery, "cursor" | "limit">;

/** Typed task operations sharing the authenticated client transport. */
export function createTaskApiClient(request: TaskApiRequest, toQuery: (query: object) => string) {
  return {
    async archiveTaskList(id: string, input: ArchiveTaskListInput): Promise<TaskList> {
      const response = await request<{ taskList: TaskList }>(`/v1/task-lists/${id}/archive`, {
        body: JSON.stringify(input),
        method: "POST",
      });
      return response.taskList;
    },
    async archiveTaskProject(id: string, input: ArchiveTaskProjectInput): Promise<TaskProject> {
      const response = await request<{ taskProject: TaskProject }>(
        `/v1/task-projects/${id}/archive`,
        {
          body: JSON.stringify(input),
          method: "POST",
        },
      );
      return response.taskProject;
    },
    async cancelTask(id: string, input: CancelTaskInput): Promise<Task> {
      const response = await request<{ task: Task }>(`/v1/tasks/${id}/cancel`, {
        body: JSON.stringify(input),
        method: "POST",
      });
      return response.task;
    },
    async cancelTaskProject(id: string, input: CancelTaskProjectInput): Promise<TaskProject> {
      const response = await request<{ taskProject: TaskProject }>(
        `/v1/task-projects/${id}/cancel`,
        {
          body: JSON.stringify(input),
          method: "POST",
        },
      );
      return response.taskProject;
    },
    async completeTask(id: string, input: CompleteTaskInput): Promise<Task> {
      const response = await request<{ task: Task }>(`/v1/tasks/${id}/complete`, {
        body: JSON.stringify(input),
        method: "POST",
      });
      return response.task;
    },
    async completeTaskProject(id: string, input: CompleteTaskProjectInput): Promise<TaskProject> {
      const response = await request<{ taskProject: TaskProject }>(
        `/v1/task-projects/${id}/complete`,
        {
          body: JSON.stringify(input),
          method: "POST",
        },
      );
      return response.taskProject;
    },
    async createTask(input: CreateTaskInput): Promise<Task> {
      const response = await request<{ task: Task }>("/v1/tasks", {
        body: JSON.stringify(input),
        method: "POST",
      });
      return response.task;
    },
    async createTaskList(input: CreateTaskListInput): Promise<TaskList> {
      const response = await request<{ taskList: TaskList }>("/v1/task-lists", {
        body: JSON.stringify(input),
        method: "POST",
      });
      return response.taskList;
    },
    async createTaskProject(input: CreateTaskProjectInput): Promise<TaskProject> {
      const response = await request<{ taskProject: TaskProject }>("/v1/task-projects", {
        body: JSON.stringify(input),
        method: "POST",
      });
      return response.taskProject;
    },
    async getTask(id: string): Promise<Task> {
      const response = await request<{ task: Task }>(`/v1/tasks/${id}`);
      return response.task;
    },
    async getTaskList(id: string): Promise<TaskList> {
      const response = await request<{ taskList: TaskList }>(`/v1/task-lists/${id}`);
      return response.taskList;
    },
    async getTaskProject(id: string): Promise<TaskProject> {
      const response = await request<{ taskProject: TaskProject }>(`/v1/task-projects/${id}`);
      return response.taskProject;
    },
    async listTaskLists(query: Partial<TaskContainerListQuery> = {}): Promise<{
      items: TaskList[];
      nextCursor: string | null;
    }> {
      return request(`/v1/task-lists?${toQuery(query)}`);
    },
    async listTaskProjects(query: Partial<TaskContainerListQuery> = {}): Promise<{
      items: TaskProject[];
      nextCursor: string | null;
    }> {
      return request(`/v1/task-projects?${toQuery(query)}`);
    },
    async listTasks(query: Partial<TaskListQuery> = {}): Promise<{
      items: Task[];
      nextCursor: string | null;
    }> {
      return request(`/v1/tasks?${toQuery(query)}`);
    },
    async moveTask(id: string, input: MoveTaskInput): Promise<Task> {
      const response = await request<{ task: Task }>(`/v1/tasks/${id}/move`, {
        body: JSON.stringify(input),
        method: "POST",
      });
      return response.task;
    },
    async moveTaskProject(id: string, input: MoveTaskProjectInput): Promise<TaskProject> {
      const response = await request<{ taskProject: TaskProject }>(`/v1/task-projects/${id}/move`, {
        body: JSON.stringify(input),
        method: "POST",
      });
      return response.taskProject;
    },
    async previewTaskMove(id: string, input: TaskMovePreviewInput): Promise<TaskMovePreview> {
      const response = await request<{ preview: TaskMovePreview }>(`/v1/tasks/${id}/move/preview`, {
        body: JSON.stringify(input),
        method: "POST",
      });
      return response.preview;
    },
    async previewTaskProjectMove(
      id: string,
      input: TaskProjectMovePreviewInput,
    ): Promise<TaskProjectMovePreview> {
      const response = await request<{ preview: TaskProjectMovePreview }>(
        `/v1/task-projects/${id}/move/preview`,
        {
          body: JSON.stringify(input),
          method: "POST",
        },
      );
      return response.preview;
    },
    async reopenTask(id: string, input: ReopenTaskInput): Promise<Task> {
      const response = await request<{ task: Task }>(`/v1/tasks/${id}/reopen`, {
        body: JSON.stringify(input),
        method: "POST",
      });
      return response.task;
    },
    async restoreTask(id: string, input: RestoreTaskInput): Promise<Task> {
      const response = await request<{ task: Task }>(`/v1/tasks/${id}/restore`, {
        body: JSON.stringify(input),
        method: "POST",
      });
      return response.task;
    },
    async trashTask(id: string, input: TrashTaskInput): Promise<Task> {
      const response = await request<{ task: Task }>(`/v1/tasks/${id}/trash`, {
        body: JSON.stringify(input),
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
    async updateTaskList(id: string, input: UpdateTaskListInput): Promise<TaskList> {
      const response = await request<{ taskList: TaskList }>(`/v1/task-lists/${id}`, {
        body: JSON.stringify(input),
        method: "PATCH",
      });
      return response.taskList;
    },
    async updateTaskProject(id: string, input: UpdateTaskProjectInput): Promise<TaskProject> {
      const response = await request<{ taskProject: TaskProject }>(`/v1/task-projects/${id}`, {
        body: JSON.stringify(input),
        method: "PATCH",
      });
      return response.taskProject;
    },
  };
}
