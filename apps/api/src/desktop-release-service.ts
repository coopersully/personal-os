import { createDesktopReleaseReader } from "@personal-os/connectors";
import type { DesktopReleaseStatus } from "@personal-os/domain";
export function createDesktopReleaseService(
  apiBaseUrl: string,
  read = createDesktopReleaseReader(),
) {
  const enabled = apiBaseUrl.replace(/\/$/, "") === "https://nohmi-api.coopersully.me";
  return (): Promise<DesktopReleaseStatus> =>
    enabled ? read() : Promise.resolve({ status: "disabled", release: null });
}
