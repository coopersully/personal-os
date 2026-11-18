import { auditEvents, calendarAccounts } from "@personal-os/database";
import { eq, sql } from "drizzle-orm";
import { encryptJson } from "../../apps/api/src/security.js";
import { createMcpWorkspaceFixture, type WorkspaceFixture } from "./fixture.js";

describe("shared workspace sources", () => {
  let f: WorkspaceFixture;
  const credentials = {
    accessToken: "fixture",
    refreshToken: "fixture",
    expiresAt: "2099-01-01T00:00:00Z",
    scope: "https://www.googleapis.com/auth/calendar.readonly",
    tokenType: "Bearer",
  };
  const listCalendars = vi.fn(async () => ({ credentials, value: [] }));
  beforeAll(async () => {
    f = await createMcpWorkspaceFixture({
      google: {
        authorizationUrl: () => "",
        exchangeCode: async () => credentials,
        getProfile: vi.fn(),
        listCalendars,
        syncCalendar: vi.fn(),
        createEvent: vi.fn(),
        updateEvent: vi.fn(),
        deleteEvent: vi.fn(),
      },
    });
  }, 120_000);
  afterAll(async () => {
    await f?.close();
  });
  it("lists owned sources and disconnects under every affected workspace grant", async () => {
    const [account] = await f.db
      .insert(calendarAccounts)
      .values({
        userId: f.owner.id,
        provider: "google",
        label: "Disconnect fixture",
        mailEnabled: false,
        encryptedCredentials: encryptJson(credentials, f.config.encryptionKey),
        calendarEnabled: true,
      })
      .returning();
    const [foreign] = await f.db
      .insert(calendarAccounts)
      .values({ userId: f.otherOwner.id, provider: "google", label: "Private other source" })
      .returning();
    if (!account || !foreign) throw Error("Missing fixtures");
    const { client, credential } = await f.connectAgent([
      "mail:read",
      "mail:write",
      "mail:execute",
      "calendar:read",
      "calendar:write",
      "calendar:execute",
      "reminders:read",
      "reminders:write",
      "tasks:write",
      "tasks:execute",
    ]);
    const listed = await client.callTool({ name: "list_workspace_sources", arguments: {} });
    expect(listed.isError, JSON.stringify(listed)).not.toBe(true);
    expect(JSON.stringify(listed)).toContain("Disconnect fixture");
    expect(JSON.stringify(listed)).not.toContain("Private other source");
    expect(
      (
        await client.callTool({
          name: "disconnect_workspace_source",
          arguments: { accountId: account.id },
        })
      ).isError,
    ).toBe(true);
    await f.setBypass(true);
    expect(
      (
        await client.callTool({
          name: "disconnect_workspace_source",
          arguments: { accountId: foreign.id },
        })
      ).isError,
    ).toBe(true);
    const sync = await client.callTool({
      name: "sync_workspace_source",
      arguments: { accountId: account.id },
    });
    expect(sync.isError, JSON.stringify(sync)).not.toBe(true);
    expect(listCalendars).toHaveBeenCalledOnce();
    expect(
      await f.db.query.auditEvents.findMany({ where: eq(auditEvents.entityId, account.id) }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "connector.sync_requested",
          actorId: credential.id,
          actorType: "agent",
        }),
      ]),
    );
    expect(
      await f.db.query.calendarAccounts.findFirst({ where: eq(calendarAccounts.id, account.id) }),
    ).toMatchObject({ syncStatus: "idle" });
    const removed = await client.callTool({
      name: "disconnect_workspace_source",
      arguments: { accountId: account.id },
    });
    expect(removed.isError, JSON.stringify(removed)).not.toBe(true);
    expect(
      await f.db.query.calendarAccounts.findFirst({ where: eq(calendarAccounts.id, account.id) }),
    ).toBeUndefined();
    expect(
      await f.db.query.auditEvents.findMany({ where: eq(auditEvents.entityId, account.id) }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actorId: credential.id,
          actorType: "agent",
          action: "connector.disconnected",
        }),
      ]),
    );
  });
  it.each([
    "token",
    "bypass",
  ])("revalidates %s consent before accepting a blocked sync claim", async (kind) => {
    await f.setBypass(true);
    const [account] = await f.db
      .insert(calendarAccounts)
      .values({
        userId: f.owner.id,
        provider: "google",
        label: "Sync race",
        mailEnabled: false,
        calendarEnabled: true,
        encryptedCredentials: encryptJson(credentials, f.config.encryptionKey),
      })
      .returning();
    const agent = await f.connectAgent([
      "mail:read",
      "mail:write",
      "mail:execute",
      "calendar:read",
      "calendar:write",
      "calendar:execute",
      "reminders:read",
      "reminders:write",
      "tasks:write",
      "tasks:execute",
    ]);
    const callsBefore = listCalendars.mock.calls.length;
    let release!: () => void;
    let ready!: () => void;
    const held = new Promise<void>((r) => {
      release = r;
    });
    const acquired = new Promise<void>((r) => {
      ready = r;
    });
    const lock = f.db.transaction(async (tx) => {
      await tx
        .select()
        .from(calendarAccounts)
        .where(eq(calendarAccounts.id, account!.id))
        .for("update");
      ready();
      await held;
    });
    await acquired;
    const syncing = agent.client.callTool({
      name: "sync_workspace_source",
      arguments: { accountId: account!.id },
    });
    try {
      let waiting = false;
      for (let i = 0; i < 100; i++) {
        const rows = await f.db.execute(
          sql`select pid from pg_stat_activity where datname=current_database() and wait_event_type='Lock' and query like '%calendar_accounts%' and pid <> pg_backend_pid()`,
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
    expect((await syncing).isError).toBe(true);
    expect(listCalendars.mock.calls.length).toBe(callsBefore);
    expect(
      await f.db.query.calendarAccounts.findFirst({ where: eq(calendarAccounts.id, account!.id) }),
    ).toMatchObject({ syncGeneration: 0 });
  });
});
