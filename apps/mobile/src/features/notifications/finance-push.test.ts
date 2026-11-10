import { describe, expect, it, vi } from "vitest";
import { createFinancePush, type FinancePushPorts, financePushPayload } from "./finance-push";

function setup() {
  const ports: FinancePushPorts = {
    api: {
      registerNativePushDevice: vi.fn(async () => ({ audience: "audience" })),
      disableNativePushDevice: vi.fn(async () => ({ disabled: true })),
      getNativePushEvent: vi.fn(async () => ({
        audience: "audience",
        destination: "finance_chat" as const,
      })),
    },
    current: vi.fn(() => true),
    permission: vi.fn(async () => true),
    token: vi.fn(async () => "apple-token"),
    installationId: vi.fn(async () => "installation"),
    readEnabled: vi.fn(async () => false),
    saveEnabled: vi.fn(async () => {}),
    clearPresented: vi.fn(async () => {}),
    open: vi.fn(),
    update: vi.fn(),
    environment: "production",
  };
  return { ports, push: createFinancePush(ports) };
}
const payload = { version: 1, kind: "finance", eventId: "event", audience: "audience" };
describe("native Finance push", () => {
  it("requires explicit opt-in before obtaining an Apple token", async () => {
    const { ports, push } = setup();
    await push.restore();
    await push.refresh();
    expect(ports.token).not.toHaveBeenCalled();
  });
  it("registers the native token with trusted environment and persists consent only after registration", async () => {
    const { ports, push } = setup();
    await push.change(true);
    expect(ports.api.registerNativePushDevice).toHaveBeenCalledWith({
      installationId: "installation",
      token: "apple-token",
      environment: "production",
      financeEnabled: true,
    });
    expect(ports.saveEnabled).toHaveBeenCalledWith(true);
  });
  it("denial unregisters and does not persist opt-in", async () => {
    const { ports, push } = setup();
    vi.mocked(ports.permission).mockResolvedValue(false);
    await expect(push.change(true)).rejects.toThrow("iOS Settings");
    expect(ports.api.disableNativePushDevice).toHaveBeenCalled();
    expect(ports.token).not.toHaveBeenCalled();
    expect(ports.saveEnabled).not.toHaveBeenCalled();
  });
  it("revoked permission unregisters on foreground sync", async () => {
    const { ports, push } = setup();
    await push.change(true);
    vi.mocked(ports.permission).mockResolvedValue(false);
    await push.refresh();
    expect(ports.api.disableNativePushDevice).toHaveBeenCalled();
    expect(ports.clearPresented).toHaveBeenCalled();
  });
  it("syncs rotated Apple tokens", async () => {
    const { ports, push } = setup();
    await push.change(true);
    vi.mocked(ports.token).mockResolvedValue("rotated");
    await push.refresh();
    expect(ports.api.registerNativePushDevice).toHaveBeenLastCalledWith(
      expect.objectContaining({ token: "rotated" }),
    );
  });
  it("fences permission completion after account switch", async () => {
    const { ports, push } = setup();
    vi.mocked(ports.permission).mockImplementation(async () => {
      vi.mocked(ports.current).mockReturnValue(false);
      return true;
    });
    await expect(push.change(true)).rejects.toThrow("account changed");
    expect(ports.token).not.toHaveBeenCalled();
    expect(ports.api.registerNativePushDevice).not.toHaveBeenCalled();
  });
  it("fences token completion after logout", async () => {
    const { ports, push } = setup();
    vi.mocked(ports.token).mockImplementation(async () => {
      push.dispose();
      return "stale";
    });
    await expect(push.change(true)).rejects.toThrow("account changed");
    expect(ports.api.registerNativePushDevice).not.toHaveBeenCalled();
  });
  it("fences registration response after owner replacement", async () => {
    const { ports, push } = setup();
    vi.mocked(ports.api.registerNativePushDevice).mockImplementation(async () => {
      vi.mocked(ports.current).mockReturnValue(false);
      return { audience: "stale" };
    });
    await expect(push.change(true)).rejects.toThrow("account changed");
    expect(ports.saveEnabled).not.toHaveBeenCalled();
    expect(ports.update).not.toHaveBeenCalled();
  });
  it("validates current audience locally and against authenticated target, then deduplicates taps", async () => {
    const { ports, push } = setup();
    await push.change(true);
    await push.tap({ ...payload, audience: "other" });
    expect(ports.api.getNativePushEvent).not.toHaveBeenCalled();
    await push.tap(payload);
    await push.tap(payload);
    expect(ports.api.getNativePushEvent).toHaveBeenCalledTimes(1);
    expect(ports.open).toHaveBeenCalledTimes(1);
  });
  it("rejects server audience mismatch and failed authorization", async () => {
    const { ports, push } = setup();
    await push.change(true);
    vi.mocked(ports.api.getNativePushEvent).mockResolvedValue({
      audience: "other",
      destination: "finance_chat",
    });
    await push.tap(payload);
    expect(ports.open).not.toHaveBeenCalled();
    vi.mocked(ports.api.getNativePushEvent).mockRejectedValue(new Error("forbidden"));
    await expect(push.tap(payload)).rejects.toThrow("forbidden");
    expect(ports.open).not.toHaveBeenCalled();
  });
  it("does not route a target resolving after logout", async () => {
    const { ports, push } = setup();
    await push.change(true);
    vi.mocked(ports.api.getNativePushEvent).mockImplementation(async () => {
      push.dispose();
      return { audience: "audience", destination: "finance_chat" };
    });
    await expect(push.tap(payload)).rejects.toThrow("account changed");
    expect(ports.open).not.toHaveBeenCalled();
  });
  it("persists opt-out and clears notifications", async () => {
    const { ports, push } = setup();
    await push.change(true);
    await push.change(false);
    expect(ports.saveEnabled).toHaveBeenLastCalledWith(false);
    expect(ports.clearPresented).toHaveBeenCalled();
    await push.tap(payload);
    expect(ports.open).not.toHaveBeenCalled();
  });
  it("rejects malformed payloads and local Task payloads", () => {
    for (const data of [
      null,
      {},
      { ...payload, version: 2 },
      { ...payload, kind: "task" },
      { ...payload, eventId: "" },
      { owner: "owner" },
    ])
      expect(financePushPayload(data)).toBeNull();
  });
});
it("compensates remote registration when persisting opt-in fails", async () => {
  const { ports, push } = setup();
  vi.mocked(ports.saveEnabled).mockRejectedValue(new Error("Keychain unavailable"));
  await expect(push.change(true)).rejects.toThrow("Keychain unavailable");
  expect(ports.api.registerNativePushDevice).toHaveBeenCalled();
  expect(ports.api.disableNativePushDevice).toHaveBeenCalledWith("installation");
  expect(ports.update).toHaveBeenCalledWith(false);
  await push.tap(payload);
  expect(ports.open).not.toHaveBeenCalled();
});
it.each([
  "finance_chat",
  "finance_attention",
  "finance_activity",
] as const)("routes the authenticated %s destination", async (destination) => {
  const { ports, push } = setup();
  await push.change(true);
  vi.mocked(ports.api.getNativePushEvent).mockResolvedValue({ audience: "audience", destination });
  await push.tap(payload);
  expect(ports.open).toHaveBeenCalledWith(destination);
});
it("still unregisters when persisting opt-out fails", async () => {
  const { ports, push } = setup();
  await push.change(true);
  vi.mocked(ports.saveEnabled).mockRejectedValue(new Error("Keychain unavailable"));
  await expect(push.change(false)).rejects.toThrow("Keychain unavailable");
  expect(ports.api.disableNativePushDevice).toHaveBeenCalledWith("installation");
  expect(ports.update).toHaveBeenLastCalledWith(false);
});

it("clears presented Finance notifications even when remote opt-out fails offline", async () => {
  const { ports, push } = setup();
  await push.change(true);
  vi.mocked(ports.api.disableNativePushDevice).mockRejectedValue(new Error("offline"));
  await expect(push.change(false)).rejects.toThrow("offline");
  expect(ports.saveEnabled).toHaveBeenLastCalledWith(false);
  expect(ports.update).toHaveBeenLastCalledWith(false);
  expect(ports.clearPresented).toHaveBeenCalledTimes(1);
  await push.tap(payload);
  expect(ports.open).not.toHaveBeenCalled();
});
