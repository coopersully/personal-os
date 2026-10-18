import { createApiClient } from "@personal-os/api-client";
import type { WorkspaceFixture } from "./fixture.js";

/** Authenticate through the real API; agent credentials never carry human approval. */
export async function connectHumanFinanceClient(fixture: WorkspaceFixture) {
  const api = createApiClient({
    baseUrl: fixture.config.apiBaseUrl,
    fetch: async (input, init) => fixture.app.request(new Request(input, init)),
  });
  const owner = await api.login({ email: fixture.owner.email, password: "FixtureOnly123!" });
  expect(owner.id).toBe(fixture.owner.id);
  return api;
}
