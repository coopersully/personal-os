import { invoke } from "@tauri-apps/api/core";
export type UpdateStatus = {
  installedVersion: string;
  availableVersion: string | null;
  phase: "unavailable" | "checking" | "downloading" | "current" | "ready" | "installing" | "error";
  downloadedBytes: number;
  totalBytes: number | null;
  checkedAt: string | null;
  error: string | null;
  startupBlocking: boolean;
};
export const getUpdateStatus = () => invoke<UpdateStatus>("desktop_update_status");
export const checkForUpdate = () => invoke<void>("desktop_update_check");
export const openWithoutUpdate = () => invoke<void>("desktop_update_open");
export const restartForUpdate = () => invoke<void>("desktop_update_restart");
