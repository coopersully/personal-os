/** Native APNs lifecycle. Async results are fenced by owner and session epoch. */
export interface FinancePushApi {
  registerNativePushDevice(input: {
    installationId: string;
    token: string;
    environment: "sandbox" | "production";
    financeEnabled: boolean;
  }): Promise<{ audience: string }>;
  disableNativePushDevice(installationId: string): Promise<unknown>;
  getNativePushEvent(
    eventId: string,
    installationId: string,
  ): Promise<{
    audience: string;
    destination: "finance_chat" | "finance_attention" | "finance_activity";
  }>;
}
export interface FinancePushPorts {
  api: FinancePushApi;
  current: () => boolean;
  permission: (request: boolean) => Promise<boolean>;
  token: () => Promise<string>;
  installationId: () => Promise<string>;
  readEnabled: () => Promise<boolean>;
  saveEnabled: (enabled: boolean) => Promise<void>;
  clearPresented: () => Promise<void>;
  open: (
    destination: "finance_chat" | "finance_attention" | "finance_activity",
    event: { eventId: string; installationId: string },
  ) => void;
  update: (enabled: boolean) => void;
  environment: "sandbox" | "production";
}
export function financePushPayload(value: unknown): { eventId: string; audience: string } | null {
  if (!value || typeof value !== "object") return null;
  const data = value as Record<string, unknown>;
  return data.version === 1 &&
    data.kind === "finance" &&
    typeof data.eventId === "string" &&
    data.eventId.length > 0 &&
    typeof data.audience === "string" &&
    data.audience.length > 0
    ? { eventId: data.eventId, audience: data.audience }
    : null;
}
export function createFinancePush(ports: FinancePushPorts) {
  let active = true;
  let enabled = false;
  let audience: string | null = null;
  let queue: Promise<unknown> = Promise.resolve();
  const handled = new Set<string>();
  const current = () => active && ports.current();
  function check() {
    if (!current()) throw new Error("Your account changed. Please try again.");
  }
  function serial<T>(job: () => Promise<T>) {
    const result = queue.then(job, job);
    queue = result.catch(() => {});
    return result;
  }
  async function disable() {
    audience = null;
    const installationId = await ports.installationId();
    check();
    // Local cleanup must not wait for, or depend on, a reachable API.
    await Promise.all([ports.clearPresented(), ports.api.disableNativePushDevice(installationId)]);
    check();
  }
  async function sync(request = false, rotatedToken?: string) {
    check();
    if (!enabled) {
      await disable();
      return;
    }
    const allowed = await ports.permission(request);
    check();
    if (!allowed) {
      await disable();
      if (request)
        throw new Error("Allow notifications in iOS Settings to enable Finance notifications.");
      return;
    }
    const token = rotatedToken ?? (await ports.token());
    check();
    const installationId = await ports.installationId();
    check();
    const registration = await ports.api.registerNativePushDevice({
      installationId,
      token,
      environment: ports.environment,
      financeEnabled: true,
    });
    check();
    audience = registration.audience;
  }
  return {
    restore: () =>
      serial(async () => {
        enabled = await ports.readEnabled();
        check();
        ports.update(enabled);
        await sync();
      }),
    refresh: (rotatedToken?: string) => serial(() => sync(false, rotatedToken)),
    change: (value: boolean) =>
      serial(async () => {
        check();
        // Persist opt-out before network work, so a failed unregister cannot re-enable later.
        if (!value) {
          enabled = false;
          audience = null;
          try {
            await ports.saveEnabled(false);
          } finally {
            check();
            ports.update(false);
            await disable();
          }
          return;
        }
        enabled = true;
        try {
          await sync(true);
          check();
          await ports.saveEnabled(true);
          check();
          ports.update(true);
        } catch (error) {
          enabled = false;
          audience = null;
          if (current()) {
            ports.update(false);
            // A failed local consent write must not leave a live remote subscription.
            await disable().catch(() => {});
          }
          throw error;
        }
      }),
    tap: (data: unknown) =>
      serial(async () => {
        const payload = financePushPayload(data);
        if (!current()) return false;
        // Keep launch responses available while registration is waiting for connectivity.
        if (enabled && !audience) return false;
        if (!enabled || !payload || payload.audience !== audience || handled.has(payload.eventId))
          return true;
        const installationId = await ports.installationId();
        check();
        const target = await ports.api.getNativePushEvent(payload.eventId, installationId);
        check();
        if (!enabled || target.audience !== audience || payload.audience !== audience) return true;
        handled.add(payload.eventId);
        ports.open(target.destination, { eventId: payload.eventId, installationId });
        return true;
      }),
    dispose: () => {
      active = false;
      enabled = false;
      audience = null;
      handled.clear();
    },
  };
}
