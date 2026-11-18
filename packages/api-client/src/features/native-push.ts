import type {
  NativePushDeviceInput,
  NativePushDeviceRegistration,
  NativePushEventDestination,
} from "@personal-os/domain";
import type { FinanceRequest } from "./finances.js";

export function createNativePushApi(request: FinanceRequest) {
  return {
    registerNativePushDevice(input: NativePushDeviceInput): Promise<NativePushDeviceRegistration> {
      return request(`/v1/native-push/devices/${encodeURIComponent(input.installationId)}`, {
        method: "PUT",
        body: JSON.stringify(input),
      });
    },
    disableNativePushDevice(installationId: string): Promise<{ disabled: true }> {
      return request(`/v1/native-push/devices/${encodeURIComponent(installationId)}`, {
        method: "DELETE",
      });
    },
    getNativePushEvent(
      eventId: string,
      installationId: string,
    ): Promise<NativePushEventDestination> {
      return request(
        `/v1/native-push/events/${encodeURIComponent(eventId)}?installationId=${encodeURIComponent(installationId)}`,
      );
    },
  };
}
