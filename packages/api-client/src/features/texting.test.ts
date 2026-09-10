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
