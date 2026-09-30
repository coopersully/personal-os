import type {
  RitualActionInput,
  RitualActionResult,
  RitualResponseInput,
  RitualState,
} from "@personal-os/domain";
import { invoke } from "@tauri-apps/api/core";
import { api } from "../../api.js";
import { isDesktop } from "./bridge.js";
export function ritualDeviceId() {
  let id = localStorage.getItem("nohmi.ritual-device");
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem("nohmi.ritual-device", id);
  }
  return id;
}
export const readRitualState = () =>
  isDesktop() ? invoke<RitualState>("ritual_state") : api.getCurrentRitual();
export const enableRitualPresentation = (enabled: boolean) =>
  isDesktop() ? invoke("ritual_preferences", { enabled }) : Promise.resolve();
export const openCurrentRitual = () => (isDesktop() ? invoke("ritual_open") : Promise.resolve());
export const submitRitualResponse = (id: string, stepId: string, input: RitualResponseInput) =>
  isDesktop()
    ? invoke<RitualState>("ritual_mutate", {
        path: `/v1/rituals/occurrences/${encodeURIComponent(id)}/responses/${encodeURIComponent(stepId)}`,
        method: "PUT",
        body: input,
      })
    : api.saveRitualResponse(id, stepId, input);
export async function submitRitualAction(
  id: string,
  input: RitualActionInput,
): Promise<RitualActionResult> {
  if (!isDesktop()) return api.recordRitualAction(id, input);
  // Persist the follow-up identifier with the press, so native replay can finish
  // an immediate snooze even if the webview exits before the request returns.
  return invoke<RitualActionResult>("ritual_mutate", {
    path: `/v1/rituals/occurrences/${encodeURIComponent(id)}/actions`,
    method: "POST",
    body: {
      ...input,
      ...(input.kind === "snooze" ? { requireConfirmation: true } : {}),
    },
    ...(input.kind === "snooze" ? { autoConfirmRequestId: crypto.randomUUID() } : {}),
  });
}

export const showRitualPreview = (state: RitualState | null, completed = false) =>
  invoke("ritual_preview", { state, completed });

export const ritualContentReady = (occurrenceId: string) =>
  invoke("ritual_ready", { occurrenceId });
