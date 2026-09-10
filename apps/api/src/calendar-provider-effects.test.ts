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
const deleteEffect: CalendarProviderEffect = {
  ...blockEffect,
  action: "delete",
};

describe("Calendar provider effect ledger", () => {
  it("rejects duplicate plans and skipped or repeated provider effects", async () => {
    expect(() =>
      createCalendarProviderEffectLedger("duplicate", [sourceEffect, { ...sourceEffect }]),
    ).toThrow("duplicate effects");

    const skipped = createCalendarProviderEffectLedger("skipped", [sourceEffect]);
    const commit = vi.fn(async () => "committed");
    await expect(skipped.commit(commit)).rejects.toThrow("still has pending effects");
    expect(commit).not.toHaveBeenCalled();

    const repeated = createCalendarProviderEffectLedger("repeated", [sourceEffect]);
    await repeated.run({ ...sourceEffect }, async () => ({ remoteEventId: "created-source" }));
    const providerOperation = vi.fn(async () => ({ remoteEventId: "duplicate-source" }));
    await expect(repeated.run({ ...sourceEffect }, providerOperation)).rejects.toThrow(
      "unknown or has already been settled",
    );
    expect(providerOperation).not.toHaveBeenCalled();
    await expect(repeated.commit(async () => "committed")).resolves.toBe("committed");
  });

  it("rejects a concurrent replay while the planned provider effect is running", async () => {
    const ledger = createCalendarProviderEffectLedger("concurrent_create", [sourceEffect]);
    let finishProvider: (() => void) | undefined;
    const running = ledger.run(
      sourceEffect,
      () =>
        new Promise<{ remoteEventId: null }>((resolve) => {
          finishProvider = () => resolve({ remoteEventId: null });
        }),
    );
    const replay = vi.fn(async () => "replayed");

    await expect(ledger.run(sourceEffect, replay)).rejects.toThrow(
      "unknown or has already been settled",
    );
    expect(replay).not.toHaveBeenCalled();
    finishProvider?.();
    await expect(running).resolves.toEqual({ remoteEventId: null });
    await expect(ledger.commit(async () => "committed")).resolves.toBe("committed");
  });

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

  it("records a provider delete partial effect without inventing a remote id", async () => {
    const ledger = createCalendarProviderEffectLedger("delete_event", [deleteEffect]);
    await expect(
      ledger.run(deleteEffect, async () =>
        Promise.reject(
          new AppError("service_unavailable", "Projection failed after provider deletion.", {
            partialEffect: "provider_event_deleted",
          }),
        ),
      ),
    ).rejects.toMatchObject({
      details: {
        completedEffects: [
          expect.objectContaining({ action: "delete", remoteEventId: "remote-block" }),
        ],
        partialEffect: "provider_event_deleted",
      },
    });
  });

  it("classifies a failed projection after provider deletion", async () => {
    const ledger = createCalendarProviderEffectLedger("delete_event", [deleteEffect]);
    await ledger.run(deleteEffect, async () => ({}));

    await expect(
      ledger.commit(async () => Promise.reject(new Error("Projection failed."))),
    ).rejects.toMatchObject({
      details: {
        completedEffects: [expect.objectContaining({ action: "delete" })],
        partialEffect: "provider_event_deleted",
      },
    });
  });

  it("reports an indeterminate first provider effect as unsafe to replay", async () => {
    const ledger = createCalendarProviderEffectLedger("create_event", [sourceEffect]);
    await expect(
      ledger.run(sourceEffect, async () =>
        Promise.reject(
          new AppError(
            "service_unavailable",
            "The Calendar provider did not confirm whether the event was created.",
            {
              effectState: "indeterminate",
              provider: "google",
              recovery: "Synchronize Calendar before retrying.",
            },
          ),
        ),
      ),
    ).rejects.toMatchObject({
      code: "service_unavailable",
      details: {
        completedEffects: [],
        indeterminateEffects: [sourceEffect],
        operation: "create_event",
        partialEffect: "provider_effect_indeterminate",
        pendingEffects: [],
        provider: "google",
        recovery: "Synchronize Calendar before retrying.",
      },
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

  it("refuses to commit after only part of the declared provider plan ran", async () => {
    const ledger = createCalendarProviderEffectLedger("incomplete_update", [
      sourceEffect,
      blockEffect,
    ]);
    await ledger.run(sourceEffect, async () => ({ remoteEventId: "created-source" }));
    const commit = vi.fn(async () => "committed");
    await expect(ledger.commit(commit)).rejects.toMatchObject({
      code: "internal_error",
      details: {
        completedEffects: [
          expect.objectContaining({
            remoteEventId: "created-source",
            role: "source",
          }),
        ],
        operation: "incomplete_update",
        pendingEffects: [blockEffect],
      },
    });
    expect(commit).not.toHaveBeenCalled();
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

  it("preserves a projection conflict after a completed provider effect", async () => {
    const ledger = createCalendarProviderEffectLedger("update_event_block", [blockEffect]);
    await ledger.run(blockEffect, async () => ({ remoteEventId: "updated-block" }));
    await expect(
      ledger.commit(async () =>
        Promise.reject(new AppError("conflict", "The Calendar block changed.")),
      ),
    ).rejects.toMatchObject({
      code: "conflict",
      details: {
        completedEffects: [expect.objectContaining({ role: "block" })],
        operation: "update_event_block",
      },
      message: "The Calendar block changed.",
    });
  });

  it("does not replace a local transaction failure when no provider effect was planned", async () => {
    const ledger = createCalendarProviderEffectLedger("local_event", []);
    const error = new Error("Local transaction failed.");
    await expect(ledger.commit(async () => Promise.reject(error))).rejects.toBe(error);
  });
});
