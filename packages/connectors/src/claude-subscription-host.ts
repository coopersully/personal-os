import { idSchema } from "@personal-os/domain";
import { PROVIDER_REQUEST_TIMEOUT_MS, providerFetch } from "./http.js";
import type {
  SubscriptionHostAdapter,
  SubscriptionHostFireInput,
  SubscriptionHostFireResult,
} from "./subscription-host.js";

const routineId = /^trig_[A-Za-z0-9]{10,100}$/;
const credential = /^sk-ant-oat01-[A-Za-z0-9_-]{10,500}$/;
const sessionId = /^session_[A-Za-z0-9]{10,100}$/;

function validate(input: SubscriptionHostFireInput) {
  if (
    !input ||
    typeof input.routineId !== "string" ||
    !routineId.test(input.routineId) ||
    typeof input.credential !== "string" ||
    !credential.test(input.credential) ||
    input.wake?.kind !== "accepted_answer" ||
    !idSchema.safeParse(input.wake.scheduleId).success ||
    !idSchema.safeParse(input.wake.continuationId).success
  ) {
    throw new TypeError("Invalid subscription host request.");
  }
}

/** Advisory only: the owning durable dispatcher decides whether a later attempt is safe. */
function retryAfterSeconds(value: string | null): number | undefined {
  const text = value?.trim();
  if (!text || text.length > 128) return undefined;
  let seconds: number;
  if (/^\d+(?:\.\d+)?$/.test(text)) seconds = Number(text);
  else {
    if (/^[+-]?\d/.test(text)) return undefined;
    const date = Date.parse(text);
    if (!Number.isFinite(date)) return undefined;
    seconds = Math.max(0, (date - Date.now()) / 1000);
  }
  return Number.isFinite(seconds) ? Math.min(86400, Math.ceil(seconds)) : undefined;
}

/** One bounded subscription call. Session acceptance never proves Finance execution. */
export function createClaudeSubscriptionHostAdapter(options: {
  fetch: typeof globalThis.fetch;
}): SubscriptionHostAdapter {
  return {
    async invoke(input, callerSignal): Promise<SubscriptionHostFireResult> {
      validate(input);
      if (callerSignal?.aborted) return { state: "uncertain", reason: "transport" };
      const deadline = new AbortController();
      const timer = setTimeout(() => deadline.abort(), PROVIDER_REQUEST_TIMEOUT_MS);
      const signal = callerSignal
        ? AbortSignal.any([callerSignal, deadline.signal])
        : deadline.signal;
      let interrupt = () => {};
      const interrupted = new Promise<never>((_, reject) => {
        interrupt = () => reject(new Error("Subscription host request interrupted."));
        signal.addEventListener("abort", interrupt, { once: true });
        if (signal.aborted) interrupt();
      });
      const bounded = <T>(operation: Promise<T>) => Promise.race([operation, interrupted]);
      let response: Response | undefined;
      let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
      let finished = false;
      let reason: "transport" | "provider_response" | "invalid_response" = "transport";
      let status: number | undefined;
      try {
        response = await bounded(
          providerFetch(
            options.fetch,
            `https://api.anthropic.com/v1/claude_code/routines/${input.routineId}/fire`,
            {
              method: "POST",
              redirect: "error",
              signal,
              headers: {
                Authorization: `Bearer ${input.credential}`,
                "anthropic-version": "2023-06-01",
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                text: JSON.stringify({
                  type: "nohmi_finance_answer_ready",
                  scheduleId: input.wake.scheduleId,
                  continuationId: input.wake.continuationId,
                }),
              }),
            },
          ),
        );
        // Injected fetch can return Response.error() (status0), which is not an HTTP receipt.
        status =
          Number.isInteger(response.status) && response.status >= 100 && response.status <= 599
            ? response.status
            : undefined;
        reason = "provider_response";
        if (status === undefined) return { state: "uncertain", reason };
        if (!response.ok) {
          if (
            status === 400 ||
            status === 401 ||
            status === 403 ||
            status === 404 ||
            status === 429
          ) {
            const retry =
              status === 429 ? retryAfterSeconds(response.headers.get("retry-after")) : undefined;
            return {
              state: "rejected",
              status,
              ...(retry === undefined ? {} : { retryAfterSeconds: retry }),
            };
          }
          return { state: "uncertain", reason, status };
        }
        reason = "invalid_response";
        reader = response.body?.getReader();
        if (!reader) throw new Error("Missing subscription host response.");
        const chunks: Uint8Array[] = [];
        let bytes = 0;
        for (;;) {
          const part = await bounded(reader.read());
          if (part.done) {
            finished = true;
            break;
          }
          bytes += part.value.byteLength;
          if (bytes > 16384) throw new Error("Subscription host response exceeds limit.");
          chunks.push(part.value);
        }
        const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        if (
          parsed &&
          typeof parsed === "object" &&
          "type" in parsed &&
          parsed.type === "routine_fire" &&
          "claude_code_session_id" in parsed &&
          typeof parsed.claude_code_session_id === "string" &&
          sessionId.test(parsed.claude_code_session_id)
        ) {
          return { state: "accepted", sessionId: parsed.claude_code_session_id, status };
        }
        return { state: "uncertain", reason, status };
      } catch {
        // No raw provider error/body/credential escapes, and ambiguity never causes a second fire.
        return { state: "uncertain", reason, ...(status === undefined ? {} : { status }) };
      } finally {
        // Cleanup shares the original deadline. It cannot discard an already established receipt.
        try {
          if (reader && !finished) await bounded(reader.cancel());
          else if (!reader && response?.body) await bounded(response.body.cancel());
        } catch {
          /* The response outcome remains factual even if cleanup fails or expires. */
        }
        try {
          reader?.releaseLock();
        } catch {
          /* A pending ignored-abort mock may still own its read. */
        }
        clearTimeout(timer);
        signal.removeEventListener("abort", interrupt);
      }
    },
  };
}
