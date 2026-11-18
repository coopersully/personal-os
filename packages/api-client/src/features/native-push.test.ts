import type { FinanceRequest } from "./finances.js";
import { createNativePushApi } from "./native-push.js";

it("uses human device endpoints and supplies installation identity for event resolution", async () => {
  const request = vi.fn(async () => ({ audience: "opaque" })) as unknown as FinanceRequest;
  const api = createNativePushApi(request);
  const input = {
    installationId: "device",
    token: "ab".repeat(32),
    environment: "production" as const,
    financeEnabled: true,
  };
  await api.registerNativePushDevice(input);
  expect(request).toHaveBeenLastCalledWith("/v1/native-push/devices/device", {
    method: "PUT",
    body: JSON.stringify(input),
  });
  await api.disableNativePushDevice("device");
  expect(request).toHaveBeenLastCalledWith("/v1/native-push/devices/device", { method: "DELETE" });
  await api.getNativePushEvent("event", "device");
  expect(request).toHaveBeenLastCalledWith("/v1/native-push/events/event?installationId=device");
});
