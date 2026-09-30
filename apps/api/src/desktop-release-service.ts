import { randomUUID } from "node:crypto";
import { createDesktopReleaseReader } from "@personal-os/connectors";
import type { DesktopReleaseStatus } from "@personal-os/domain";
import type { RequestLog } from "./types.js";
export function createDesktopReleaseService(
  apiBaseUrl: string,
  read?: () => Promise<DesktopReleaseStatus>,
  log?: (entry: RequestLog) => void,
) {
  const reader =
    read ??
    createDesktopReleaseReader(globalThis.fetch, Date.now, (failure) => {
      log?.({
        event: "desktop_release_unavailable",
        code: failure.reason,
        status: failure.status,
        durationMs: failure.durationMs,
        method: "GET",
        path: "/v1/desktop-release",
        requestId: randomUUID(),
      });
    });
  const enabled = apiBaseUrl.replace(/\/$/, "") === "https://nohmi-api.coopersully.me";
  return (): Promise<DesktopReleaseStatus> =>
    enabled ? reader() : Promise.resolve({ status: "disabled", release: null });
}
