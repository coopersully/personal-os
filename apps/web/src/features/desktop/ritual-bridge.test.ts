// @vitest-environment jsdom
import {
  enableRitualPresentation,
  openCurrentRitual,
  readRitualState,
  ritualContentReady,
  ritualDeviceId,
  showRitualPreview,
  submitRitualAction,
  submitRitualResponse,
} from "./ritual-bridge.js";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  desktop: vi.fn(),
  current: vi.fn(),
  response: vi.fn(),
  action: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("./bridge.js", () => ({ isDesktop: mocks.desktop }));
vi.mock("../../api.js", () => ({
  api: {
    getCurrentRitual: mocks.current,
    saveRitualResponse: mocks.response,
    recordRitualAction: mocks.action,
  },
}));
const input = {
  requestId: "request",
  expectedRevision: 1,
  deviceId: "mac",
  kind: "snooze" as const,
  observedAt: "2026-09-29T12:00:00Z",
};
beforeEach(() => {
  vi.resetAllMocks();
  mocks.desktop.mockReturnValue(true);
});
it("hands snooze and its durable follow-up ID to native in a single invocation", async () => {
  const result = { outcome: "applied", state: {} };
  mocks.invoke.mockResolvedValue(result);
  expect(await submitRitualAction("occurrence", input)).toBe(result);
  expect(mocks.invoke).toHaveBeenCalledTimes(1);
  expect(mocks.invoke).toHaveBeenCalledWith("ritual_mutate", {
    path: "/v1/rituals/occurrences/occurrence/actions",
    method: "POST",
    body: { ...input, requireConfirmation: true },
    autoConfirmRequestId: expect.stringMatching(/^[a-f0-9-]{36}$/),
  });
  expect(mocks.invoke.mock.calls[0]?.[1].autoConfirmRequestId).not.toBe(input.requestId);
});
it.each([
  { count: 2 },
  { count: 0, historyUnavailable: true },
])("leaves counted or offline confirmation to the user: %j", async (extra) => {
  mocks.invoke.mockResolvedValue({
    outcome: "confirmation_required",
    challengeId: "request",
    state: { current: { revision: 2 } },
    ...extra,
  });
  expect((await submitRitualAction("occurrence", input)).outcome).toBe("confirmation_required");
  expect(mocks.invoke).toHaveBeenCalledTimes(1);
});

it("routes native state, preferences and responses through the account-fenced bridge", async () => {
  await readRitualState();
  expect(mocks.invoke).toHaveBeenLastCalledWith("ritual_state");
  await enableRitualPresentation(false);
  expect(mocks.invoke).toHaveBeenLastCalledWith("ritual_preferences", { enabled: false });
  await openCurrentRitual();
  expect(mocks.invoke).toHaveBeenLastCalledWith("ritual_open");
  const answer = { ...input, value: "Private text", submitted: false };
  await submitRitualResponse("occ/one", "step/two", answer);
  expect(mocks.invoke).toHaveBeenLastCalledWith("ritual_mutate", {
    path: "/v1/rituals/occurrences/occ%2Fone/responses/step%2Ftwo",
    method: "PUT",
    body: answer,
  });
  mocks.invoke.mockResolvedValue({ outcome: "applied", state: {} });
  await submitRitualAction("occ", { ...input, kind: "skip" });
  expect(mocks.invoke).toHaveBeenLastCalledWith("ritual_mutate", {
    path: "/v1/rituals/occurrences/occ/actions",
    method: "POST",
    body: { ...input, kind: "skip" },
  });
  localStorage.removeItem("nohmi.ritual-device");
  const device = ritualDeviceId();
  expect(device).toBeTruthy();
  expect(ritualDeviceId()).toBe(device);
});
it("uses authenticated web transport without trying native preferences in a browser", async () => {
  mocks.desktop.mockReturnValue(false);
  await readRitualState();
  expect(mocks.current).toHaveBeenCalled();
  await enableRitualPresentation(true);
  await openCurrentRitual();
  const answer = { ...input, value: true, submitted: true };
  await submitRitualResponse("occ", "step", answer);
  expect(mocks.response).toHaveBeenCalledWith("occ", "step", answer);
  await submitRitualAction("occ", input);
  expect(mocks.action).toHaveBeenCalledWith("occ", input);
  expect(mocks.invoke).not.toHaveBeenCalled();
});
it("does not auto-confirm an occurrence that disappeared", async () => {
  mocks.invoke.mockResolvedValue({
    outcome: "confirmation_required",
    count: 0,
    challengeId: "request",
    state: { current: null },
  });
  await submitRitualAction("occ", input);
  expect(mocks.invoke).toHaveBeenCalledTimes(1);
});

it("starts presentation only after content readiness and forwards preview completion", async () => {
  await ritualContentReady("preview-current");
  expect(mocks.invoke).toHaveBeenLastCalledWith("ritual_ready", {
    occurrenceId: "preview-current",
  });
  await showRitualPreview(null, true);
  expect(mocks.invoke).toHaveBeenLastCalledWith("ritual_preview", { state: null, completed: true });
  await showRitualPreview(null);
  expect(mocks.invoke).toHaveBeenLastCalledWith("ritual_preview", {
    state: null,
    completed: false,
  });
});
