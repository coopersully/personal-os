import type { Database } from "@personal-os/database";
import { createAuthService } from "./auth-service.js";

describe("auth service failure propagation", () => {
  it("preserves non-conflict database failures during registration", async () => {
    const failure = new Error("database unavailable");
    const db = {
      transaction: vi.fn(async () => {
        throw failure;
      }),
    } as unknown as Database;
    const auth = createAuthService({ db, now: () => new Date(), sessionTtlDays: 30 });

    await expect(
      auth.register(
        {
          displayName: "Failure Test",
          email: "failure@example.com",
          password: "LocalTestOnly123!",
          planningTimezone: "UTC",
        },
        { ipAddress: null, userAgent: null },
      ),
    ).rejects.toBe(failure);
  });
});
