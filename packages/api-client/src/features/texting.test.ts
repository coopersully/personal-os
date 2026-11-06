import { textingConsentVersion } from "@personal-os/domain";
import { createTextingApiClient } from "./texting.js";

describe("texting API client", () => {
  it("maps every operation onto the authenticated HTTP transport", async () => {
    const request = vi.fn(async (path: string) => {
      if (path === "/v1/texting") return { connection: { id: null } };
      if (path.includes("/conversation")) return { messages: [] };
      if (path.includes("/messages")) return { message: { id: "message" } };
      if (path.endsWith("/check")) return { connection: { id: "connection" } };
      return { challenge: { id: "challenge" } };
    });
    const api = createTextingApiClient(
      request as unknown as <T>(path: string, init?: RequestInit) => Promise<T>,
      (value) => new URLSearchParams(value as Record<string, string>).toString(),
    );
    await expect(api.getTextingConnection()).resolves.toEqual({ id: null });
    await expect(
      api.startTextingVerification({
        consentAccepted: true,
        consentVersion: textingConsentVersion,
        country: "US",
        phoneNumber: "+12125550123",
      }),
    ).resolves.toEqual({ id: "challenge" });
    await expect(api.checkTextingVerification("challenge", { code: "123456" })).resolves.toEqual({
      id: "connection",
    });
    await expect(api.getTextConversation("UTC", { limit: 10 })).resolves.toEqual({ messages: [] });
    await expect(
      api.sendTextMessage("UTC", {
        body: "Hi",
        contentKind: "concise",
        conversationReceipt: "receipt",
      }),
    ).resolves.toEqual({ id: "message" });
    await expect(api.disconnectTexting()).resolves.toBeUndefined();
    expect(request).toHaveBeenCalledTimes(6);
  });
});

it("maps notification preferences, references and recovery without supplying current-work evidence", async () => {
  const { defaultNotificationPreferences } = await import("@personal-os/domain");
  const request = vi.fn(async () => ({})) as unknown as Parameters<
    typeof createTextingApiClient
  >[0];
  const api = createTextingApiClient(request, () => "");
  await api.getNotificationStatus();
  expect(request).toHaveBeenLastCalledWith("/v1/texting/notifications");
  const input = { expectedRevision: null, preferences: defaultNotificationPreferences };
  await api.saveNotificationPreferences("finances", input);
  expect(request).toHaveBeenLastCalledWith("/v1/texting/notifications/preferences/finances", {
    method: "PATCH",
    body: JSON.stringify(input),
  });
});

it("reads one exact Finance reply status without a mutation or query-bearing destination", async () => {
  const inboundMessageId = "11111111-1111-4111-8111-111111111111";
  const status = {
    inboundMessageId,
    state: "waiting",
    reasonCode: "processing_uncertain",
    children: [],
    reviewHref: "/settings?section=reviews",
  };
  const request = vi.fn(async () => status) as unknown as Parameters<
    typeof createTextingApiClient
  >[0];
  const api = createTextingApiClient(request, () => "");
  await expect(api.getFinanceTextReplyStatus(inboundMessageId)).resolves.toEqual(status);
  expect(request).toHaveBeenCalledWith(`/v1/texting/finance-replies/${inboundMessageId}/status`);
  expect(request).toHaveBeenCalledTimes(1);
});

it("resets only the Finance notification override with its revision", async () => {
  const request = vi.fn(async () => ({})) as unknown as Parameters<
    typeof createTextingApiClient
  >[0];
  const api = createTextingApiClient(request, () => "");
  await api.resetFinanceNotificationPreferences({ expectedRevision: 3 });
  expect(request).toHaveBeenCalledWith("/v1/texting/notifications/preferences/finances", {
    method: "DELETE",
    body: JSON.stringify({ expectedRevision: 3 }),
  });
});

it("uses a separate exact notification GET with no-store and cannot turn the ID into owner/query authority", async () => {
  const { createApiClient } = await import("../client.js");
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValue(Response.json({ id: "safe-reference" }));
  const api = createApiClient({
    baseUrl: "https://api.example.test",
    token: "inspection-token",
    fetch,
  });
  await api.getNotificationAttempt("11111111-1111-4111-8111-111111111111?ownerId=foreign/record");
  expect(fetch).toHaveBeenCalledTimes(1);
  const [url, init] = fetch.mock.calls[0] ?? [];
  expect(url).toBe(
    "https://api.example.test/v1/texting/notifications/attempts/11111111-1111-4111-8111-111111111111%3FownerId%3Dforeign%2Frecord",
  );
  expect(init?.cache).toBe("no-store");
  expect(init?.method ?? "GET").toBe("GET");
  expect(init?.body).toBeUndefined();
});

it("maps the bounded Texting agent protocol to owner-authenticated endpoints", async () => {
  const request = vi.fn(async () => ({})) as unknown as Parameters<
    typeof createTextingApiClient
  >[0];
  const api = createTextingApiClient(request, () => "");
  await api.getTextingAgentStatus();
  expect(request).toHaveBeenLastCalledWith("/v1/texting/agent", { cache: "no-store" });
  await api.configureTextingAgent({ scheduleId: null });
  expect(request).toHaveBeenLastCalledWith("/v1/texting/agent", {
    method: "PUT",
    body: '{"scheduleId":null}',
  });
  const invocationId = crypto.randomUUID();
  await api.claimTextingAgentRun("run/id", { invocationId });
  expect(request).toHaveBeenLastCalledWith("/v1/texting/agent/runs/run%2Fid/claim", {
    method: "POST",
    body: JSON.stringify({ invocationId }),
  });
  await api.checkpointTextingAgentRun("run", { invocationId, work: [] });
  expect(request).toHaveBeenLastCalledWith("/v1/texting/agent/runs/run/checkpoint", {
    method: "POST",
    body: JSON.stringify({ invocationId, work: [] }),
  });
  await api.replyToTextingAgentRun("run", {
    invocationId,
    body: "Your reply",
    workspaces: ["tasks"],
    replyToMessageIds: [invocationId],
  });
  expect(request).toHaveBeenLastCalledWith("/v1/texting/agent/runs/run/reply", {
    method: "POST",
    body: JSON.stringify({
      invocationId,
      body: "Your reply",
      workspaces: ["tasks"],
      replyToMessageIds: [invocationId],
    }),
  });
});
