import {
  financeAccountConnections,
  financeAccounts,
  financeMutationRecords,
} from "@personal-os/database";
import { eq, sql } from "drizzle-orm";
import { createMcpWorkspaceFixture, type WorkspaceFixture } from "./fixture.js";

describe("bank authorization handoff", () => {
  let f: WorkspaceFixture;
  const logs: unknown[] = [];
  let consent = false;
  let accountSuffix = "";
  let onHosted: (() => Promise<void>) | undefined;
  let onReceipt: (() => Promise<void>) | undefined;
  const exchange = vi.fn(async () => ({ accessToken: "private-access", itemId: "hosted-item" }));
  const provider = {
    createLinkToken: async () => "raw-link-token",
    createHostedLink: vi.fn(async () => {
      await onHosted?.();
      return {
        linkToken: "private-link",
        url: "https://secure.plaid.com/hl/fixture",
        expiresAt: "2026-10-11T15:30:00Z",
      };
    }),
    getHostedLinkResult: async () => {
      await onReceipt?.();
      return {
        publicTokens: consent ? ["private-public-token"] : [],
        institutions: { "private-public-token": "Fixture Credit Union" },
      };
    },
    exchangePublicToken: exchange,
    getItem: async () => ({ itemId: "hosted-item" }),
    getAccounts: async () => [
      {
        accountId: "hosted-account" + accountSuffix,
        balanceCurrent: 20,
        currencyCode: "USD",
        name: "Hosted cash" + accountSuffix,
        officialName: null,
      },
    ],
    validateCredentials: async () => undefined,
    syncTransactions: async () => ({
      added: [],
      modified: [],
      removed: [],
      hasMore: false,
      nextCursor: "end",
      transactionsUpdateStatus: "HISTORICAL_UPDATE_COMPLETE" as const,
    }),
  };
  beforeAll(async () => {
    f = await createMcpWorkspaceFixture({ plaid: provider, log: (entry) => logs.push(entry) });
  }, 120_000);
  afterAll(async () => {
    await f?.close();
  });
  it("returns a usable provider URL and completes only after provider-confirmed consent", async () => {
    await f.setBypass(true);
    const { client, api } = await f.connectAgent([
      "finances:read",
      "finances:write",
      "finances:execute",
    ]);
    const startArgs = { provider: "plaid", idempotencyKey: crypto.randomUUID() };
    const started = await client.callTool({
      name: "start_finance_account_connection",
      arguments: startArgs,
    });
    expect(started.isError, JSON.stringify(started)).not.toBe(true);
    const data = (
      started.structuredContent as {
        data: { connectionId: string; externalHandoff: { artifact: string } };
      }
    ).data;
    expect(data.externalHandoff.artifact).toBe("https://secure.plaid.com/hl/fixture");
    const input = { connectionId: data.connectionId };
    const pending = await client.callTool({
      name: "complete_finance_account_connection",
      arguments: input,
    });
    expect(pending.isError, JSON.stringify(pending)).not.toBe(true);
    expect(JSON.stringify(pending)).toContain("pending");
    expect(exchange).not.toHaveBeenCalled();
    consent = true;
    exchange.mockImplementationOnce(async () => {
      const replay = await client.callTool({
        name: "start_finance_account_connection",
        arguments: startArgs,
      });
      expect(replay.structuredContent).toMatchObject({
        outcome: "work_remaining",
        data: { externalHandoff: null },
      });
      return { accessToken: "private-access", itemId: "hosted-item" };
    });
    const completed = await client.callTool({
      name: "complete_finance_account_connection",
      arguments: input,
    });
    expect(completed.isError, JSON.stringify(completed)).not.toBe(true);
    expect(JSON.stringify(completed)).toContain("connected");
    expect(JSON.stringify(completed)).not.toContain("private-");
    expect(exchange).toHaveBeenCalledOnce();
    const receipt = await client.callTool({
      name: "get_finance_account_connection",
      arguments: input,
    });
    expect(receipt.isError, JSON.stringify(receipt)).not.toBe(true);
    expect(JSON.stringify(receipt)).toContain("connected");
    await client.callTool({ name: "complete_finance_account_connection", arguments: input });
    expect(exchange).toHaveBeenCalledOnce();
    expect((await api.listFinanceAccounts()).accounts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "Hosted cash", institution: "Fixture Credit Union" }),
      ]),
    );
  });
  it("persists an inspectable start attempt before provider work and retains failures on replay", async () => {
    await f.setBypass(true);
    const agent = await f.connectAgent(["finances:read", "finances:write", "finances:execute"]);
    const before = await f.db.select().from(financeAccountConnections);
    let observed: string | undefined;
    onHosted = async () => {
      const rows = await f.db.select().from(financeAccountConnections);
      observed = rows.find((row) => !before.some((old) => old.id === row.id))?.id;
      throw new Error("Controlled provider rejection");
    };
    const args = { provider: "plaid", idempotencyKey: crypto.randomUUID() };
    try {
      const failed = await agent.client.callTool({
        name: "start_finance_account_connection",
        arguments: args,
      });
      expect(failed.structuredContent).toMatchObject({
        outcome: "failed",
        remainingWork: { categories: ["connection_restart"], count: 1 },
      });
      expect(observed).toBeDefined();
      expect(
        await f.db.query.financeAccountConnections.findFirst({
          where: eq(financeAccountConnections.id, observed!),
        }),
      ).toMatchObject({ status: "failed", lastError: { code: "provider_handoff_failed" } });
      const calls = provider.createHostedLink.mock.calls.length;
      const replay = await agent.client.callTool({
        name: "start_finance_account_connection",
        arguments: args,
      });
      expect(provider.createHostedLink.mock.calls.length).toBe(calls);
      expect(JSON.stringify(replay)).toContain(observed!);
      expect(JSON.stringify(replay)).toContain("failed");
      expect(replay.structuredContent).toMatchObject({ outcome: "failed" });
      expect(logs).toContainEqual(
        expect.objectContaining({
          event: "connector_handoff_failed",
          code: "provider_handoff_failed",
        }),
      );
    } finally {
      onHosted = undefined;
    }
  });
  it("records uncertain storage failure after provider success without repeating the session", async () => {
    await f.setBypass(true);
    const agent = await f.connectAgent(["finances:read", "finances:write", "finances:execute"]);
    await f.db.execute(
      sql`create function fail_handoff_storage() returns trigger language plpgsql as $$ begin if NEW.external_handoff_url is not null then raise exception 'private-link controlled storage failure'; end if; return NEW; end $$`,
    );
    await f.db.execute(
      sql`create trigger fail_handoff_storage before update on finance_account_connections for each row execute function fail_handoff_storage()`,
    );
    const args = { provider: "plaid", idempotencyKey: crypto.randomUUID() };
    try {
      const failed = await agent.client.callTool({
        name: "start_finance_account_connection",
        arguments: args,
      });
      expect(failed.isError, JSON.stringify(failed)).not.toBe(true);
      expect(failed.structuredContent).toMatchObject({
        outcome: "failed",
        data: { status: "failed", externalHandoff: null },
      });
      const id = (failed.structuredContent as { data: { connectionId: string } }).data.connectionId;
      expect(
        await f.db.query.financeAccountConnections.findFirst({
          where: eq(financeAccountConnections.id, id),
        }),
      ).toMatchObject({ lastError: { code: "handoff_persistence_failed", retryable: false } });
      const calls = provider.createHostedLink.mock.calls.length;
      const replay = await agent.client.callTool({
        name: "start_finance_account_connection",
        arguments: args,
      });
      expect(replay.structuredContent).toMatchObject({ outcome: "failed" });
      expect(provider.createHostedLink.mock.calls.length).toBe(calls);
      expect(logs).toContainEqual(
        expect.objectContaining({
          event: "connector_handoff_failed",
          code: "handoff_persistence_failed",
          provider: "plaid",
        }),
      );
      expect(JSON.stringify(logs)).not.toContain("private-link");
    } finally {
      await f.db.execute(sql`drop trigger fail_handoff_storage on finance_account_connections`);
      await f.db.execute(sql`drop function fail_handoff_storage()`);
    }
  });
  it("replays a pre-upgrade nested connection receipt without another provider request", async () => {
    await f.setBypass(true);
    const agent = await f.connectAgent(["finances:read", "finances:write", "finances:execute"]);
    const args = { provider: "plaid", idempotencyKey: crypto.randomUUID() };
    const started = await agent.client.callTool({
      name: "start_finance_account_connection",
      arguments: args,
    });
    const data = (started.structuredContent as { data: { connectionId: string } }).data;
    await f.db
      .update(financeMutationRecords)
      .set({
        response: {
          data: { connectionId: data.connectionId },
          outcome: "external_action_required",
        },
      })
      .where(eq(financeMutationRecords.idempotencyKey, args.idempotencyKey));
    const calls = provider.createHostedLink.mock.calls.length;
    const replay = await agent.client.callTool({
      name: "start_finance_account_connection",
      arguments: args,
    });
    expect(replay.isError, JSON.stringify(replay)).not.toBe(true);
    expect(replay.structuredContent).toMatchObject({ data: { connectionId: data.connectionId } });
    expect(provider.createHostedLink.mock.calls.length).toBe(calls);
  });
  it("keeps the live bank URL out of ordinary status reads", async () => {
    await f.setBypass(true);
    const agent = await f.connectAgent(["finances:read", "finances:write", "finances:execute"]);
    const reader = await f.connectAgent(["finances:read"]);
    const args = { provider: "plaid", idempotencyKey: crypto.randomUUID() };
    const started = await agent.client.callTool({
      name: "start_finance_account_connection",
      arguments: args,
    });
    const { connectionId } = (started.structuredContent as { data: { connectionId: string } }).data;
    for (const client of [reader.client, agent.client]) {
      const status = await client.callTool({
        name: "get_finance_account_connection",
        arguments: { connectionId },
      });
      expect(status.isError, JSON.stringify(status)).not.toBe(true);
      expect(status.structuredContent).toMatchObject({
        data: { status: "pending", externalHandoff: null },
      });
      expect(JSON.stringify(status)).not.toContain("secure.plaid.com");
    }
    const replay = await agent.client.callTool({
      name: "start_finance_account_connection",
      arguments: args,
    });
    expect(replay.structuredContent).toMatchObject({
      data: { externalHandoff: { artifact: "https://secure.plaid.com/hl/fixture" } },
    });
    await f.setBypass(false);
    expect(
      (await agent.client.callTool({ name: "start_finance_account_connection", arguments: args }))
        .isError,
    ).toBe(true);
  });
  it("does not exchange after authority is revoked while awaiting provider consent", async () => {
    consent = true;
    await f.setBypass(true);
    const agent = await f.connectAgent(["finances:read", "finances:write", "finances:execute"]);
    const started = await agent.client.callTool({
      name: "start_finance_account_connection",
      arguments: { provider: "plaid", idempotencyKey: crypto.randomUUID() },
    });
    const { connectionId } = (started.structuredContent as { data: { connectionId: string } }).data;
    const before = exchange.mock.calls.length;
    onReceipt = async () => {
      await agent.revoke();
    };
    try {
      const response = await agent.client.callTool({
        name: "complete_finance_account_connection",
        arguments: { connectionId },
      });
      expect(response.isError).toBe(true);
      expect(exchange.mock.calls.length).toBe(before);
    } finally {
      onReceipt = undefined;
    }
  });
  it("does not claim a provider exchange after queued completion loses its grant", async () => {
    consent = true;
    await f.setBypass(true);
    const agent = await f.connectAgent(["finances:read", "finances:write", "finances:execute"]);
    const started = await agent.client.callTool({
      name: "start_finance_account_connection",
      arguments: { provider: "plaid", idempotencyKey: crypto.randomUUID() },
    });
    const { connectionId } = (started.structuredContent as { data: { connectionId: string } }).data;
    const calls = exchange.mock.calls.length;
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
        .from(financeAccountConnections)
        .where(eq(financeAccountConnections.id, connectionId))
        .for("update");
      ready();
      await held;
    });
    await acquired;
    const completing = agent.client.callTool({
      name: "complete_finance_account_connection",
      arguments: { connectionId },
    });
    try {
      let waiting = false;
      for (let i = 0; i < 100; i++) {
        const rows = await f.db.execute(
          sql`select pid from pg_stat_activity where datname=current_database() and wait_event_type='Lock' and query like '%finance_account_connections%' and pid <> pg_backend_pid()`,
        );
        if (rows.rows.length) {
          waiting = true;
          break;
        }
        await new Promise((r) => setTimeout(r, 20));
      }
      expect(waiting).toBe(true);
      await agent.revoke();
    } finally {
      release();
      await lock;
    }
    expect((await completing).isError).toBe(true);
    expect(exchange.mock.calls.length).toBe(calls);
  });
  it("retains one successful exchange across a transient credential-storage failure", async () => {
    await f.setBypass(true);
    const agent = await f.connectAgent(["finances:read", "finances:write", "finances:execute"]);
    const started = await agent.client.callTool({
      name: "start_finance_account_connection",
      arguments: { provider: "plaid", idempotencyKey: crypto.randomUUID() },
    });
    const { connectionId } = (started.structuredContent as { data: { connectionId: string } }).data;
    await f.db.execute(sql`create sequence exchange_storage_attempt`);
    await f.db.execute(sql`create function fail_exchange_storage_once() returns trigger language plpgsql as $$
      begin
        if OLD.last_error->>'code' = 'exchange_in_progress' and NEW.last_error is null
          and nextval('exchange_storage_attempt') = 1 then
          raise exception 'fixture transient exchange storage failure';
        end if;
        return NEW;
      end $$`);
    await f.db.execute(
      sql`create trigger fail_exchange_storage_once before update on finance_account_connections for each row execute function fail_exchange_storage_once()`,
    );
    const calls = exchange.mock.calls.length;
    consent = true;
    accountSuffix = "-storage-retry";
    try {
      const completed = await agent.client.callTool({
        name: "complete_finance_account_connection",
        arguments: { connectionId, idempotencyKey: crypto.randomUUID() },
      });
      expect(completed.isError, JSON.stringify(completed)).not.toBe(true);
      expect(completed.structuredContent).toMatchObject({
        outcome: "completed",
        data: { status: "connected" },
      });
      expect(exchange.mock.calls.length).toBe(calls + 1);
      expect(JSON.stringify(completed)).not.toContain("private-access");
      const replay = await agent.client.callTool({
        name: "complete_finance_account_connection",
        arguments: { connectionId, idempotencyKey: crypto.randomUUID() },
      });
      expect(replay.isError, JSON.stringify(replay)).not.toBe(true);
      expect(exchange.mock.calls.length).toBe(calls + 1);
    } finally {
      consent = false;
      accountSuffix = "";
      await f.db.execute(
        sql`drop trigger fail_exchange_storage_once on finance_account_connections`,
      );
      await f.db.execute(sql`drop function fail_exchange_storage_once()`);
      await f.db.execute(sql`drop sequence exchange_storage_attempt`);
    }
  });
  it("bounds failed credential retention and never re-exchanges after storage stays unavailable", async () => {
    await f.setBypass(true);
    const agent = await f.connectAgent(["finances:read", "finances:write", "finances:execute"]);
    const started = await agent.client.callTool({
      name: "start_finance_account_connection",
      arguments: { provider: "plaid", idempotencyKey: crypto.randomUUID() },
    });
    const { connectionId } = (started.structuredContent as { data: { connectionId: string } }).data;
    await f.db.execute(sql`create sequence failed_exchange_storage_attempt`);
    await f.db.execute(sql`create function fail_exchange_storage_always() returns trigger language plpgsql as $$
      begin
        if OLD.last_error->>'code' = 'exchange_in_progress' and NEW.last_error is null then
          perform nextval('failed_exchange_storage_attempt');
          raise exception 'fixture persistent exchange storage failure';
        end if;
        return NEW;
      end $$`);
    await f.db.execute(
      sql`create trigger fail_exchange_storage_always before update on finance_account_connections for each row execute function fail_exchange_storage_always()`,
    );
    const calls = exchange.mock.calls.length;
    consent = true;
    try {
      const completed = await agent.client.callTool({
        name: "complete_finance_account_connection",
        arguments: { connectionId, idempotencyKey: crypto.randomUUID() },
      });
      expect(completed.isError).toBe(true);
      const attempts = await f.db.execute(
        sql`select last_value from failed_exchange_storage_attempt`,
      );
      expect(Number(attempts.rows[0]?.last_value)).toBe(3);
      const status = await agent.client.callTool({
        name: "get_finance_account_connection",
        arguments: { connectionId },
      });
      expect(status.structuredContent).toMatchObject({
        data: { status: "needs_reauth", lastError: { code: "exchange_persistence_failed" } },
      });
      const replay = await agent.client.callTool({
        name: "complete_finance_account_connection",
        arguments: { connectionId, idempotencyKey: crypto.randomUUID() },
      });
      expect(replay.isError).toBe(true);
      expect(exchange.mock.calls.length).toBe(calls + 1);
      expect(logs).toContainEqual(
        expect.objectContaining({
          event: "connector_handoff_failed",
          code: "exchange_persistence_failed",
        }),
      );
      expect(JSON.stringify(logs)).not.toContain("private-access");
    } finally {
      consent = false;
      await f.db.execute(
        sql`drop trigger fail_exchange_storage_always on finance_account_connections`,
      );
      await f.db.execute(sql`drop function fail_exchange_storage_always()`);
      await f.db.execute(sql`drop sequence failed_exchange_storage_attempt`);
    }
  });
  it("expires pending consent without exchanging and keeps failures safe to inspect", async () => {
    consent = false;
    const agent = await f.connectAgent(["finances:read", "finances:write", "finances:execute"]);
    const startArgs = { provider: "plaid", idempotencyKey: crypto.randomUUID() };
    const started = await agent.client.callTool({
      name: "start_finance_account_connection",
      arguments: startArgs,
    });
    const { connectionId } = (started.structuredContent as { data: { connectionId: string } }).data;
    f.advanceTime(31 * 60_000);
    const replay = await agent.client.callTool({
      name: "start_finance_account_connection",
      arguments: startArgs,
    });
    expect(replay.structuredContent).toMatchObject({
      outcome: "work_remaining",
      data: { externalHandoff: null },
    });
    const response = await agent.client.callTool({
      name: "complete_finance_account_connection",
      arguments: { connectionId },
    });
    expect(response.isError, JSON.stringify(response)).not.toBe(true);
    expect(JSON.stringify(response)).toContain("needs_reauth");
    expect(JSON.stringify(response)).not.toContain("private-");
  });
  it("never repeats an uncertain single-use exchange", async () => {
    consent = true;
    const agent = await f.connectAgent(["finances:read", "finances:write", "finances:execute"]);
    const started = await agent.client.callTool({
      name: "start_finance_account_connection",
      arguments: { provider: "plaid", idempotencyKey: crypto.randomUUID() },
    });
    const { connectionId } = (started.structuredContent as { data: { connectionId: string } }).data;
    exchange.mockRejectedValueOnce(new Error("Controlled provider timeout"));
    const before = exchange.mock.calls.length;
    const response = await agent.client.callTool({
      name: "complete_finance_account_connection",
      arguments: { connectionId },
    });
    expect(response.isError).toBe(true);
    const repeated = await agent.client.callTool({
      name: "complete_finance_account_connection",
      arguments: { connectionId },
    });
    expect(repeated.isError).toBe(true);
    expect(exchange.mock.calls.length).toBe(before + 1);
    expect(JSON.stringify(await agent.api.getFinanceAccountConnection(connectionId))).toContain(
      "exchange_uncertain",
    );
  });
  it("commits account attachment and handoff completion atomically", async () => {
    consent = true;
    accountSuffix = "-atomic";
    const agent = await f.connectAgent(["finances:read", "finances:write", "finances:execute"]);
    const started = await agent.client.callTool({
      name: "start_finance_account_connection",
      arguments: { provider: "plaid", idempotencyKey: crypto.randomUUID() },
    });
    const { connectionId } = (started.structuredContent as { data: { connectionId: string } }).data;
    await f.db.execute(
      sql`create function fail_handoff_terminal() returns trigger language plpgsql as $$ begin if NEW.status='connected' then raise exception 'controlled terminal write failure'; end if; return NEW; end $$`,
    );
    await f.db.execute(
      sql`create trigger fail_handoff_terminal before update on finance_account_connections for each row execute function fail_handoff_terminal()`,
    );
    const before = exchange.mock.calls.length;
    try {
      expect(
        (
          await agent.client.callTool({
            name: "complete_finance_account_connection",
            arguments: { connectionId },
          })
        ).isError,
      ).toBe(true);
      expect(
        await f.db.query.financeAccounts.findFirst({
          where: eq(financeAccounts.name, "Hosted cash-atomic"),
        }),
      ).toBeUndefined();
    } finally {
      await f.db.execute(sql`drop trigger fail_handoff_terminal on finance_account_connections`);
    }
    expect(
      (
        await agent.client.callTool({
          name: "complete_finance_account_connection",
          arguments: { connectionId },
        })
      ).isError,
    ).not.toBe(true);
    expect(exchange.mock.calls.length).toBe(before + 1);
    accountSuffix = "";
  });
});
