import type {
  CreateGoalInput,
  CreateMotiveInput,
  Goal,
  Motive,
  UpdateGoalInput,
  UpdateMotiveInput,
} from "@personal-os/domain";

export type GoalApiRequest = <T>(path: string, init?: RequestInit) => Promise<T>;

/** Typed goals and motives operations sharing the authenticated client transport. */
export function createGoalsApiClient(request: GoalApiRequest) {
  return {
    async createGoal(input: CreateGoalInput): Promise<Goal> {
      const response = await request<{ goal: Goal }>("/v1/goals", {
        body: JSON.stringify(input),
        method: "POST",
      });
      return response.goal;
    },
    async createMotive(input: CreateMotiveInput): Promise<Motive> {
      const response = await request<{ motive: Motive }>("/v1/motives", {
        body: JSON.stringify(input),
        method: "POST",
      });
      return response.motive;
    },
    async deleteGoal(id: string): Promise<void> {
      await request<void>(`/v1/goals/${id}`, { method: "DELETE" });
    },
    async deleteMotive(id: string): Promise<void> {
      await request<void>(`/v1/motives/${id}`, { method: "DELETE" });
    },
    async listGoals(): Promise<Goal[]> {
      const response = await request<{ goals: Goal[] }>("/v1/goals");
      return response.goals;
    },
    async listMotives(): Promise<Motive[]> {
      const response = await request<{ motives: Motive[] }>("/v1/motives");
      return response.motives;
    },
    async updateGoal(id: string, input: UpdateGoalInput): Promise<Goal> {
      const response = await request<{ goal: Goal }>(`/v1/goals/${id}`, {
        body: JSON.stringify(input),
        method: "PATCH",
      });
      return response.goal;
    },
    async updateMotive(id: string, input: UpdateMotiveInput): Promise<Motive> {
      const response = await request<{ motive: Motive }>(`/v1/motives/${id}`, {
        body: JSON.stringify(input),
        method: "PATCH",
      });
      return response.motive;
    },
  };
}
