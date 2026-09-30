import type { DesktopReleaseStatus } from "@personal-os/domain";
export function createDesktopReleaseApiClient(request: <T>(path: string) => Promise<T>) {
  return { getDesktopRelease: () => request<DesktopReleaseStatus>("/v1/desktop-release") };
}
