import { describe, expect, it } from "vitest";
import {
  financeConversationSendInputSchema,
  financeConversationSequenceSchema,
  projectFinanceConversationReadiness,
} from "./conversation.js";

describe("Finance conversation contracts", () => {
  it("preserves sequences above JavaScript's safe integer boundary", () => {
    expect(financeConversationSequenceSchema.parse("9007199254740993")).toBe("9007199254740993");
    for (const value of [1, "01", "-1", "1.5", "1e3"]) {
      expect(financeConversationSequenceSchema.safeParse(value).success).toBe(false);
    }
  });
  it("requires durable send identity and rejects host authority fields", () => {
    expect(financeConversationSendInputSchema.safeParse({ text: "hello" }).success).toBe(false);
    expect(
      financeConversationSendInputSchema.safeParse({
        text: "hello",
        idempotencyKey: "send",
        verified: true,
      }).success,
    ).toBe(false);
  });
  it("keeps history readable across every authority and capability loss", () => {
    for (const registrationState of ["missing", "active", "paused", "revoked"] as const) {
      for (const connectionState of ["missing", "live", "disconnected", "revoked"] as const) {
        for (const messageCapability of [
          "unverified",
          "verified",
          "expired",
          "protocol_upgrade_required",
        ] as const) {
          const result = projectFinanceConversationReadiness({
            registrationState,
            connectionState,
            messageCapability,
            executionAuthorized: true,
          });
          expect(result.historyReadable).toBe(true);
          expect(result.canSend).toBe(
            registrationState === "active" &&
              connectionState === "live" &&
              messageCapability === "verified",
          );
          expect(result.recovery === "none").toBe(result.canSend);
        }
      }
    }
  });
  it("fails closed on execution grant or owner policy loss without suggesting reconnect", () => {
    expect(
      projectFinanceConversationReadiness({
        registrationState: "active",
        connectionState: "live",
        messageCapability: "verified",
        executionAuthorized: false,
      }),
    ).toMatchObject({
      canSend: false,
      historyReadable: true,
      reason: "execution_not_authorized",
      recovery: "authorize_execution",
    });
  });
});
