import { financeAccounts, financeProviderItems } from "@personal-os/database";
import { eq, sql } from "drizzle-orm";
import { encryptJson } from "../../apps/api/src/security.js";
import { createMcpWorkspaceFixture, type WorkspaceFixture } from "./fixture.js";

describe("bank synchronization through MCP", () => {
  let f: WorkspaceFixture;
  const syncTransactions = vi.fn(async () => ({
    added: [],
    modified: [],
    removed: [],
    hasMore: false,
    nextCursor: "confirmed-cursor",
    transactionsUpdateStatus: "HISTORICAL_UPDATE_COMPLETE" as const,
  }));
  beforeAll(async () => {
    f = await createMcpWorkspaceFixture({
      plaid: {
        createLinkToken: async () => "unused",
        exchangePublicToken: async () => ({ accessToken: "fixture", itemId: "fixture-item" }),
        getItem: async () => ({ itemId: "fixture-item" }),
        validateCredentials: async () => undefined,
        syncTransactions,
        getAccounts: async () => [
          {
            accountId: "fixture-account",
            balanceCurrent: 12.34,
            currencyCode: "USD",
            name: "Fixture bank",
            officialName: null,
          },
        ],
      },
    });
  }, 120_000);
  afterAll(async () => {
    await f?.close();
  });
  it("executes an authorized sync, persists the cursor and balance, and preserves partial failures", async () => {
    const [item] = await f.db
      .insert(financeProviderItems)
      .values({
        userId: f.owner.id,
        provider: "plaid",
        providerItemId: "fixture-item",
        encryptedCredentials: encryptJson({ accessToken: "fixture" }, f.config.encryptionKey),
        syncState: "stale",
      })
      .returning();
    if (!item) throw new Error("Missing provider item");
    const [account] = await f.db
      .insert(financeAccounts)
      .values({
        userId: f.owner.id,
        name: "Fixture bank",
        institution: "Fixture bank",
        provider: "plaid",
        providerAccountId: "fixture-account",
        providerItemRecordId: item.id,
        status: "connected",
      })
      .returning();
    if (!account) throw new Error("Missing account");
    const { client } = await f.connectAgent([
      "finances:read",
      "finances:write",
      "finances:execute",
    ]);
    await f.setBypass(false);
    const denied = await client.callTool({
      name: "sync_finance_accounts",
      arguments: { accountIds: [account.id] },
    });
    expect(JSON.stringify(denied)).toContain("forbidden");
    expect(syncTransactions).not.toHaveBeenCalled();
    await f.setBypass(true);
    const missing = crypto.randomUUID();
    const response = await client.callTool({
      name: "sync_finance_accounts",
      arguments: { accountIds: [account.id, missing] },
    });
    expect(response.isError, JSON.stringify(response)).not.toBe(true);
    expect(JSON.stringify(response)).toContain(account.id);
    expect(JSON.stringify(response)).toContain("not_found");
    expect(syncTransactions).toHaveBeenCalledOnce();
    expect(
      await f.db.query.financeProviderItems.findFirst({
        where: eq(financeProviderItems.id, item.id),
      }),
    ).toMatchObject({ syncCursor: "confirmed-cursor" });
    expect(
      await f.db.query.financeAccounts.findFirst({ where: eq(financeAccounts.id, account.id) }),
    ).toMatchObject({ balance: 1234 });
  });
  it.each([
    "token",
    "bypass",
  ])("rejects a queued sync when its %s authority is withdrawn", async (kind) => {
    await f.setBypass(true);
    const account = await f.db.query.financeAccounts.findFirst({
      where: eq(financeAccounts.userId, f.owner.id),
    });
    if (!account?.providerItemRecordId) throw new Error("Missing linked fixture");
    const agent = await f.connectAgent(["finances:read", "finances:write", "finances:execute"]);
    const before = syncTransactions.mock.calls.length;
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
        .from(financeProviderItems)
        .where(eq(financeProviderItems.id, account.providerItemRecordId!))
        .for("update");
      ready();
      await held;
    });
    await acquired;
    const syncing = agent.client.callTool({
      name: "sync_finance_accounts",
      arguments: { accountIds: [account.id] },
    });
    try {
      let waiting = false;
      for (let i = 0; i < 100; i++) {
        const rows = await f.db.execute(
          sql`select pid from pg_stat_activity where datname=current_database() and wait_event_type='Lock' and query like '%finance_provider_items%' and pid <> pg_backend_pid()`,
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
    const result = await syncing;
    expect(syncTransactions.mock.calls.length).toBe(before);
    expect(JSON.stringify(result)).toContain("forbidden");
  });
});
