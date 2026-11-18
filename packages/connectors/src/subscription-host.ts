/** Transport correlation only. The owning API verifies authority and durable admission. */
export type SubscriptionHostFireInput = {
  routineId: string;
  credential: string;
  wake: { kind: "accepted_answer"; scheduleId: string; continuationId: string };
};

export type SubscriptionHostFireResult =
  | { state: "accepted"; sessionId: string; status: number }
  | {
      state: "rejected";
      status: 400 | 401 | 403 | 404 | 429;
      retryAfterSeconds?: number;
    }
  | {
      state: "uncertain";
      reason: "transport" | "provider_response" | "invalid_response";
      status?: number;
    };

export interface SubscriptionHostAdapter {
  invoke(
    input: SubscriptionHostFireInput,
    signal?: AbortSignal,
  ): Promise<SubscriptionHostFireResult>;
}
