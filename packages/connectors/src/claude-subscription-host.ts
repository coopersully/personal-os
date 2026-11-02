import type { SubscriptionHostAdapter } from "./subscription-host.js";

/** Behavioral RED stub; not a released provider implementation. */
export function createClaudeSubscriptionHostAdapter(options: {
  fetch: typeof globalThis.fetch;
}): SubscriptionHostAdapter {
  void options;
  return {
    async invoke() {
      return { state: "uncertain", reason: "transport" };
    },
  };
}
