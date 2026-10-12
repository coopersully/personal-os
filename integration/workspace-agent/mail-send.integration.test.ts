import {
  auditEvents,
  calendarAccounts,
  mailboxes,
  mailDrafts,
  mailMessages,
  mailThreads,
} from "@personal-os/database";
import { eq, sql } from "drizzle-orm";
import { encryptJson } from "../../apps/api/src/security.js";
import { createMcpWorkspaceFixture, type WorkspaceFixture } from "./fixture.js";

describe("Mail sends through MCP and the connected provider boundary", () => {
  let f: WorkspaceFixture;
  const credentials = {
    accessToken: "fixture",
    refreshToken: "fixture-refresh",
    expiresAt: "2099-01-01T00:00:00.000Z",
    scope:
      "https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.modify",
    tokenType: "Bearer",
  };
  const sendMail = vi.fn(async () => credentials);
  const updateMailThread = vi.fn(async () => credentials);
  beforeAll(async () => {
    f = await createMcpWorkspaceFixture({
      google: {
        authorizationUrl: () => "https://example.invalid/authorize",
        exchangeCode: async () => credentials,
        getProfile: vi.fn(),
        listCalendars: vi.fn(),
        syncCalendar: vi.fn(),
        createEvent: vi.fn(),
        updateEvent: vi.fn(),
        deleteEvent: vi.fn(),
        sendMail,
        updateMailThread,
        downloadMailAttachment: async () => ({
          credentials,
          value: new TextEncoder().encode("test"),
        }),
      },
    });
  }, 120_000);
  afterAll(async () => {
    await f?.close();
  });
  it("moves a thread between owned mailboxes and applies bounded bulk flags", async () => {
    const [account] = await f.db
      .insert(calendarAccounts)
      .values({
        userId: f.owner.id,
        provider: "google",
        label: "Move fixture",
        mailEnabled: true,
        encryptedCredentials: encryptJson(credentials, f.config.encryptionKey),
      })
      .returning();
    const [mailbox] = await f.db
      .insert(mailboxes)
      .values({
        userId: f.owner.id,
        accountId: account!.id,
        provider: "google",
        remoteMailboxId: "INBOX",
        name: "Inbox",
        role: "inbox",
      })
      .returning();
    const [thread] = await f.db
      .insert(mailThreads)
      .values({
        userId: f.owner.id,
        accountId: account!.id,
        provider: "google",
        remoteThreadId: "move-thread",
        subject: "Move fixture",
        snippet: "",
        bodyText: "",
        from: { address: "sender@example.com", name: null },
        to: [],
        receivedAt: new Date("2026-10-11T14:00:00Z"),
        remoteMailboxIds: [],
      })
      .returning();
    const { client } = await f.connectAgent(["mail:read", "mail:write"]);
    const moved = await client.callTool({
      name: "update_mail",
      arguments: {
        id: thread!.id,
        expectedUpdatedAt: thread!.updatedAt.toISOString(),
        mailboxIds: [mailbox!.id],
      },
    });
    expect(moved.isError, JSON.stringify(moved)).not.toBe(true);
    expect(updateMailThread).toHaveBeenCalledWith(
      expect.anything(),
      "move-thread",
      expect.objectContaining({ addMailboxIds: ["INBOX"] }),
    );
    const loaded = await client.callTool({ name: "read_mail", arguments: { id: thread!.id } });
    const current = (loaded.structuredContent as { result: { updatedAt: string } }).result;
    const bulk = await client.callTool({
      name: "bulk_update_mail",
      arguments: {
        items: [{ id: thread!.id, expectedUpdatedAt: current.updatedAt }],
        starred: true,
      },
    });
    expect(bulk.isError, JSON.stringify(bulk)).not.toBe(true);
    expect(bulk.structuredContent).toMatchObject({ result: { updatedCount: 1, failedCount: 0 } });
    expect(
      await f.db.query.mailThreads.findFirst({ where: eq(mailThreads.id, thread!.id) }),
    ).toMatchObject({ remoteMailboxIds: ["INBOX"], starred: true });
  });
  it("requires standing authority, sends exactly once and recovers uncertain delivery without resending", async () => {
    const [account] = await f.db
      .insert(calendarAccounts)
      .values({
        userId: f.owner.id,
        provider: "google",
        label: "Send fixture",
        email: "sender@example.com",
        mailEnabled: true,
        encryptedCredentials: encryptJson(credentials, f.config.encryptionKey),
      })
      .returning();
    if (!account) throw new Error("Missing account");
    const { client } = await f.connectAgent(["mail:read", "mail:write", "mail:execute"]);
    async function draft() {
      const r = await client.callTool({
        name: "create_mail_draft",
        arguments: {
          accountId: account!.id,
          to: [{ address: "recipient@example.com", name: "Recipient" }],
          subject: "Controlled test",
          body: "Fixture only",
        },
      });
      expect(r.isError, JSON.stringify(r)).not.toBe(true);
      return (r.structuredContent as { result: { id: string; updatedAt: string } }).result;
    }
    const first = await draft();
    const args = { draftId: first.id, confirmedUpdatedAt: first.updatedAt };
    await f.setBypass(false);
    expect((await client.callTool({ name: "send_mail_draft", arguments: args })).isError).toBe(
      true,
    );
    expect(sendMail).not.toHaveBeenCalled();
    await f.setBypass(true);
    const sent = await client.callTool({ name: "send_mail_draft", arguments: args });
    expect(sent.isError, JSON.stringify(sent)).not.toBe(true);
    expect(sendMail).toHaveBeenCalledOnce();
    expect(
      await f.db.query.mailDrafts.findFirst({ where: eq(mailDrafts.id, first.id) }),
    ).toMatchObject({ sendStatus: "sent" });
    expect((await client.callTool({ name: "send_mail_draft", arguments: args })).isError).toBe(
      true,
    );
    expect(sendMail).toHaveBeenCalledOnce();
    const second = await draft();
    sendMail.mockRejectedValueOnce(new Error("Provider accepted; response transport closed"));
    expect(
      (
        await client.callTool({
          name: "send_mail_draft",
          arguments: { draftId: second.id, confirmedUpdatedAt: second.updatedAt },
        })
      ).isError,
    ).toBe(true);
    expect(
      await f.db.query.mailDrafts.findFirst({ where: eq(mailDrafts.id, second.id) }),
    ).toMatchObject({ sendStatus: "reconcile" });
    const reconciled = await client.callTool({
      name: "reconcile_mail_draft",
      arguments: { draftId: second.id, outcome: "sent" },
    });
    expect(reconciled.isError, JSON.stringify(reconciled)).not.toBe(true);
    expect(sendMail).toHaveBeenCalledTimes(2);
    expect(
      await f.db.query.mailDrafts.findFirst({ where: eq(mailDrafts.id, second.id) }),
    ).toMatchObject({ sendStatus: "sent" });
    const audit = await f.db.select().from(auditEvents).where(eq(auditEvents.entityId, first.id));
    expect(audit).toEqual(
      expect.arrayContaining([expect.objectContaining({ actorType: "agent" })]),
    );
  });
  it.each([
    "token",
    "bypass",
  ])("does not send when %s consent is withdrawn before the draft claim", async (kind) => {
    await f.setBypass(true);
    const [account] = await f.db
      .insert(calendarAccounts)
      .values({
        userId: f.owner.id,
        provider: "google",
        label: "Claim race",
        email: "sender@example.com",
        mailEnabled: true,
        encryptedCredentials: encryptJson(credentials, f.config.encryptionKey),
      })
      .returning();
    const agent = await f.connectAgent(["mail:read", "mail:write", "mail:execute"]);
    const draft = await agent.api.createMailDraft({
      cc: [],
      accountId: account!.id,
      to: [{ address: "recipient@example.com", name: null }],
      subject: "Race",
      body: "Fixture",
    });
    const callsBefore = sendMail.mock.calls.length;
    let release!: () => void;
    let ready!: () => void;
    const held = new Promise<void>((r) => {
      release = r;
    });
    const acquired = new Promise<void>((r) => {
      ready = r;
    });
    const lock = f.db.transaction(async (tx) => {
      await tx.select().from(mailDrafts).where(eq(mailDrafts.id, draft.id)).for("update");
      ready();
      await held;
    });
    await acquired;
    const sending = agent.client.callTool({
      name: "send_mail_draft",
      arguments: {
        draftId: draft.id,
        confirmedUpdatedAt: draft.updatedAt,
      },
    });
    try {
      let waiting = false;
      for (let attempt = 0; attempt < 100; attempt++) {
        const rows = await f.db.execute(
          sql`select pid, query from pg_stat_activity where datname=current_database() and wait_event_type='Lock' and query like '%mail_drafts%' and pid <> pg_backend_pid()`,
        );
        if (rows.rows.length) {
          waiting = true;
          break;
        }
        await new Promise((r) => setTimeout(r, 20));
      }
      expect(waiting).toBe(true);
      if (kind === "token") await agent.revoke();
      else await f.setBypass(false);
    } finally {
      release();
      await lock;
    }
    expect((await sending).isError).toBe(true);
    expect(sendMail.mock.calls.length).toBe(callsBefore);
    expect(
      await f.db.query.mailDrafts.findFirst({ where: eq(mailDrafts.id, draft.id) }),
    ).toMatchObject({ sendStatus: "draft", sendClaimId: null });
  });
  it("downloads an attachment with a provider identifier and excludes foreign owners", async () => {
    const [account] = await f.db
      .insert(calendarAccounts)
      .values({
        userId: f.owner.id,
        provider: "google",
        label: "Attachments",
        mailEnabled: true,
        encryptedCredentials: encryptJson(credentials, f.config.encryptionKey),
      })
      .returning();
    if (!account) throw Error("Missing account");
    const [thread] = await f.db
      .insert(mailThreads)
      .values({
        userId: f.owner.id,
        accountId: account.id,
        provider: "google",
        remoteThreadId: "attachment-thread",
        subject: "Fixture",
        snippet: "",
        bodyText: "",
        from: { address: "sender@example.com", name: null },
        to: [],
        receivedAt: new Date(),
      })
      .returning();
    if (!thread) throw Error("Missing thread");
    const [message] = await f.db
      .insert(mailMessages)
      .values({
        threadId: thread.id,
        remoteMessageId: "message",
        receivedAt: new Date(),
        from: { address: "sender@example.com", name: null },
        to: [],
        cc: [],
        bodyText: "",
        attachments: [
          {
            id: "part:provider-id/1",
            filename: "../notes.txt",
            contentType: "text/plain",
            size: 4,
          },
        ],
      })
      .returning();
    if (!message) throw Error("Missing message");
    const { client } = await f.connectAgent(["mail:read"]);
    const args = { messageId: message.id, attachmentId: "part:provider-id/1" };
    const result = await client.callTool({ name: "download_mail_attachment", arguments: args });
    expect(result.isError, JSON.stringify(result)).not.toBe(true);
    expect(result.structuredContent).toMatchObject({
      result: { data: "dGVzdA==", size: 4, filename: ".._notes.txt", contentType: "text/plain" },
    });
    const foreign = await f.connectAgent(["mail:read"], { ownerId: f.otherOwner.id });
    expect(
      (await foreign.client.callTool({ name: "download_mail_attachment", arguments: args }))
        .isError,
    ).toBe(true);
  });
});
