import { textInboundClaims, textingConnections, textMessages } from "@personal-os/database";
import { eq } from "drizzle-orm";
import { encryptJson } from "../../apps/api/src/security.js";
import { createMcpWorkspaceFixture, type WorkspaceFixture } from "./fixture.js";

describe("Texting provider boundary through MCP", () => {
  let f: WorkspaceFixture;
  const sendMessage = vi.fn(async () => ({
    sid: "SMfixture-send",
    status: "queued",
    numSegments: "1",
  }));
  beforeAll(async () => {
    f = await createMcpWorkspaceFixture({
      twilio: {
        sendMessage,
        checkVerification: async () => "approved",
        startVerification: async () => ({ sid: "fixture", status: "pending" }),
        getMessageOccurredAt: async () => new Date("2026-10-11T15:00:00Z"),
        validateWebhook: () => true,
      },
    });
  }, 120_000);
  afterAll(async () => {
    await f?.close();
  });
  it("reads an owned Finance reply status without sending or exposing the message", async () => {
    const [connection] = await f.db
      .insert(textingConnections)
      .values({
        userId: f.otherOwner.id,
        encryptedPhoneNumber: encryptJson({ e164: "+12025550124" }, f.config.encryptionKey),
        phoneFingerprint: "fixture-reply",
        phoneLastFour: "0124",
        country: "US",
        consentVersion: "fixture",
        verifiedAt: new Date("2026-10-11T14:00:00Z"),
      })
      .returning();
    const [inbound] = await f.db
      .insert(textMessages)
      .values({
        userId: f.otherOwner.id,
        connectionId: connection!.id,
        direction: "inbound",
        status: "delivered",
        body: "Private fixture reply",
        occurredAt: new Date("2026-10-11T15:00:00Z"),
        occurredAtSource: "provider",
      })
      .returning();
    await f.db.insert(textInboundClaims).values({
      userId: f.otherOwner.id,
      connectionId: connection!.id,
      messageId: inbound!.id,
      consentEpoch: connection!.consentEpoch,
    });
    const { client } = await f.connectAgent(["texting:read", "finances:read"], {
      ownerId: f.otherOwner.id,
    });
    const response = await client.callTool({
      name: "get_texting_finance_reply_status",
      arguments: { inboundMessageId: inbound!.id },
    });
    expect(response.isError, JSON.stringify(response)).not.toBe(true);
    expect(response.structuredContent).toMatchObject({
      result: { inboundMessageId: inbound!.id, state: "waiting" },
    });
    expect(JSON.stringify(response)).not.toContain("Private fixture reply");
  });
  it("sends once from a fresh conversation receipt and rejects a stale replay", async () => {
    await f.setBypass(true);
    await f.db.insert(textingConnections).values({
      userId: f.owner.id,
      encryptedPhoneNumber: encryptJson({ e164: "+12025550123" }, f.config.encryptionKey),
      phoneFingerprint: "fixture-texting",
      phoneLastFour: "0123",
      country: "US",
      consentVersion: "fixture",
      verifiedAt: new Date("2026-10-11T14:00:00Z"),
    });
    const { client } = await f.connectAgent(["texting:read", "texting:write", "texting:execute"]);
    const read = await client.callTool({
      name: "read_text_conversation",
      arguments: { limit: 100 },
    });
    expect(read.isError, JSON.stringify(read)).not.toBe(true);
    const receipt = (read.structuredContent as { result: { conversationReceipt: string } }).result
      .conversationReceipt;
    expect(receipt).toBeTruthy();
    const args = {
      body: "Controlled fixture message",
      conversationReceipt: receipt,
      contentKind: "concise",
    };
    const sent = await client.callTool({ name: "send_text_message", arguments: args });
    expect(sent.isError, JSON.stringify(sent)).not.toBe(true);
    expect(sendMessage).toHaveBeenCalledOnce();
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ to: "+12025550123" }));
    expect(
      await f.db.select().from(textMessages).where(eq(textMessages.userId, f.owner.id)),
    ).toEqual([
      expect.objectContaining({
        direction: "outbound",
        body: expect.stringContaining("Controlled fixture message"),
        status: "queued",
      }),
    ]);
    expect((await client.callTool({ name: "send_text_message", arguments: args })).isError).toBe(
      true,
    );
    expect(sendMessage).toHaveBeenCalledOnce();
  });
});
