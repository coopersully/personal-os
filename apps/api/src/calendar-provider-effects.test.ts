import type { CalendarProviderEffect } from "./calendar-provider-effects.js";
import { createCalendarProviderEffectLedger } from "./calendar-provider-effects.js";
import { AppError } from "./errors.js";

const sourceEffect: CalendarProviderEffect = {
  action: "create",
  calendarId: "11111111-1111-4111-8111-111111111111",
  eventId: null,
  provider: "google",
  remoteEventId: null,
  role: "source",
};
const blockEffect: CalendarProviderEffect = {
  action: "update",
  calendarId: "22222222-2222-4222-8222-222222222222",
  eventId: "33333333-3333-4333-8333-333333333333",
  provider: "icloud",
  remoteEventId: "remote-block",
  role: "block",
};

describe("Calendar provider effect ledger", () => {
  it("does not replace a provider failure when no effect is known to have completed", async () => {
    const ledger = createCalendarProviderEffectLedger("create_event", [sourceEffect]);
    const error = new Error("Provider rejected the request.");
    await expect(ledger.run(sourceEffect, async () => Promise.reject(error))).rejects.toBe(error);
  });

  it("preserves a connector partial-effect contract and adds reconciliation state", async () => {
    const ledger = createCalendarProviderEffectLedger("create_event", [sourceEffect]);
    await expect(
      ledger.run(sourceEffect, async () =>
        Promise.reject(
          new AppError("service_unavailable", "Credential persistence failed.", {
            partialEffect: "provider_event_created",
            provider: "google",
            recovery: "Synchronize Calendar, then reconnect if authorization fails.",
            remoteEventId: "provider-created",
            stage: "credential_persistence",
          }),
        ),
      ),
    ).rejects.toMatchObject({
      code: "service_unavailable",
      details: {
        completedEffects: [
          expect.objectContaining({
            remoteEventId: "provider-created",
            role: "source",
          }),
        ],
        operation: "create_event",
        partialEffect: "provider_event_created",
        pendingEffects: [],
        stage: "credential_persistence",
      },
      message: "Credential persistence failed.",
    });
  });

  it("reports prior completed and later pending effects when a provider loop fails", async () => {
    const ledger = createCalendarProviderEffectLedger("update_event", [sourceEffect, blockEffect]);
    await ledger.run(sourceEffect, async () => ({ remoteEventId: "created-source" }));
    await expect(
      ledger.run(blockEffect, async () => Promise.reject(new Error("Second provider failed."))),
    ).rejects.toMatchObject({
      code: "service_unavailable",
      details: {
        completedEffects: [
          expect.objectContaining({
            remoteEventId: "created-source",
            role: "source",
          }),
        ],
        operation: "update_event",
        pendingEffects: [blockEffect],
        recovery: expect.stringContaining("Synchronize Calendar before retrying"),
      },
    });
  });

  it("reports a projection failure after a provider result and preserves DB details", async () => {
    const ledger = createCalendarProviderEffectLedger("update_event_block", [blockEffect]);
    await ledger.run(blockEffect, async () => ({ remoteEventId: "updated-block" }));
    await expect(
      ledger.commit(async () =>
        Promise.reject(new AppError("internal_error", "Projection failed.", { stage: "audit" })),
      ),
    ).rejects.toMatchObject({
      code: "service_unavailable",
      details: {
        completedEffects: [
          expect.objectContaining({
            action: "update",
            remoteEventId: "updated-block",
          }),
        ],
        operation: "update_event_block",
        partialEffect: "provider_event_updated",
        pendingEffects: [],
        provider: "icloud",
        remoteEventId: "updated-block",
        stage: "audit",
      },
    });
  });

  it("does not replace a local transaction failure when no provider effect was planned", async () => {
    const ledger = createCalendarProviderEffectLedger("local_event", []);
    const error = new Error("Local transaction failed.");
    await expect(ledger.commit(async () => Promise.reject(error))).rejects.toBe(error);
  });
});
