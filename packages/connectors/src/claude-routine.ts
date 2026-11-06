import { providerFetch } from "./http.js";

export type ClaudeRoutineResult = {
  state: "started" | "uncertain" | "blocked";
  hostSessionId: string | null;
  reason: string | null;
};

/** No retry: this subscription endpoint creates a fresh session on every successful POST. */
export async function fireClaudeRoutine(
  fetch: typeof globalThis.fetch,
  input: { routineId: string; token: string; runId: string },
): Promise<ClaudeRoutineResult> {
  if (!/^trig_[A-Za-z0-9]{10,100}$/.test(input.routineId))
    return { state: "blocked", hostSessionId: null, reason: "invalid_routine" };
  try {
    const response = await providerFetch(
      fetch,
      `https://api.anthropic.com/v1/claude_code/routines/${input.routineId}/fire`,
      {
        method: "POST",
        redirect: "error",
        headers: {
          Authorization: `Bearer ${input.token}`,
          "anthropic-version": "2023-06-01",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text: JSON.stringify({ type: "nohmi_texting_ready", runId: input.runId }),
        }),
      },
    );
    if ([400, 401, 403, 404, 429].includes(response.status)) {
      await response.body?.cancel();
      return {
        state: "blocked",
        hostSessionId: null,
        reason: response.status === 429 ? "rate_limited" : "host_rejected",
      };
    }
    if (!response.ok) {
      await response.body?.cancel();
      return { state: "uncertain", hostSessionId: null, reason: "host_uncertain" };
    }
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Missing response");
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    try {
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        bytes += part.value.byteLength;
        if (bytes > 16_384) throw new Error("Oversized response");
        chunks.push(part.value);
      }
    } finally {
      await reader.cancel();
    }
    const body: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (
      body &&
      typeof body === "object" &&
      "type" in body &&
      body.type === "routine_fire" &&
      "claude_code_session_id" in body &&
      typeof body.claude_code_session_id === "string" &&
      /^session_[A-Za-z0-9]{10,100}$/.test(body.claude_code_session_id)
    )
      return { state: "started", hostSessionId: body.claude_code_session_id, reason: null };
  } catch {
    /* The durable submitting record remains the recovery authority. */
  }
  return { state: "uncertain", hostSessionId: null, reason: "host_uncertain" };
}
