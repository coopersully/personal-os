import type { Database } from "@personal-os/database";
import { describe, expect, it } from "vitest";
import { createFinanceConversationEvidenceService } from "./conversation-evidence-service.js";

const id = "11111111-1111-4111-8111-111111111111";
const input = { candidateId: id, candidateRevision: `sha256:${"a".repeat(64)}` };
describe("run-bound effect inspection boundary", () => {
  it("rejects owner impersonation and tokens without maintenance before any database or effect access", async () => {
    const evidence = createFinanceConversationEvidenceService({
      db: {} as Database,
      cursorSecret: "existing-server-key",
    });
    await expect(
      evidence.readRunEvidence(
        {
          userId: id,
          actorId: id,
          actorType: "user",
          scopes: new Set([
            "finances:read",
            "finances:write",
            "finances:maintain",
            "finances:execute",
          ]),
        },
        id,
        input,
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      evidence.readRunEvidence(
        {
          userId: id,
          actorId: id,
          actorType: "agent",
          scopes: new Set(["finances:read", "finances:write", "finances:execute"]),
        },
        id,
        input,
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
  });
  it("rejects forged cursors and self-reported proof fields before storage inspection", async () => {
    const evidence = createFinanceConversationEvidenceService({
      db: {} as Database,
      cursorSecret: "existing-server-key",
    });
    const principal = {
      userId: id,
      actorId: id,
      actorType: "agent" as const,
      scopes: new Set(["finances:maintain"] as const),
    };
    await expect(
      evidence.readRunEvidence(principal, id, { ...input, cursor: "forged" }),
    ).rejects.toMatchObject({ code: "invalid_request" });
    await expect(
      evidence.readRunEvidence(principal, id, { ...input, verified: true } as never),
    ).rejects.toThrow();
  });
});
