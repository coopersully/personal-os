import type { Database, financeAccountConnections } from "@personal-os/database";
import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "../errors.js";
import { encryptJson } from "../security.js";
import { createFinanceConnectionHandoffService } from "./connection-handoff-service.js";
import type { FinanceMutationContext } from "./context.js";

const idempotency = vi.hoisted(() => vi.fn());
vi.mock("./context.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./context.js")>()),
  executeFinanceIdempotently: idempotency,
}));
beforeEach(() => {
  idempotency.mockReset();
  idempotency.mockImplementation(
    async (
      db: unknown,
      _context: unknown,
      _operation: unknown,
      mutate: (tx: unknown) => Promise<unknown>,
    ) => mutate(db),
  );
});

type Options = Parameters<typeof createFinanceConnectionHandoffService>[0];
type Connection = typeof financeAccountConnections.$inferSelect;
const owner = "a1050000-0000-4000-8000-000000000001";
const connectionId = "a1050000-0000-4000-8000-000000000002";
const key = Buffer.alloc(32, 7).toString("base64");
const at = new Date("2026-10-18T12:00:00Z");
const context: FinanceMutationContext = {
  userId: owner,
  actorId: owner,
  actorType: "user",
  canMutate: true,
  canSelfApprove: false,
  bypassEnabled: false,
  requestId: "handoff-unit",
};

/** Transaction/provider adapters are controlled here; these are not PostgreSQL durability proofs. */
function harness(changes: Partial<Connection> = {}) {
  const row: Connection = {
    id: connectionId,
    userId: owner,
    provider: "plaid",
    status: "pending",
    accountIds: [],
    externalHandoffUrl: "https://provider.example.test/synthetic-consent",
    externalHandoffExpiresAt: new Date("2026-10-18T13:00:00Z"),
    encryptedHandoffState: encryptJson({ phase: "waiting", linkToken: "synthetic-link" }, key),
    lastError: null,
    version: 1,
    createdAt: at,
    updatedAt: at,
    ...changes,
  };
  const writes: Partial<Connection>[] = [];
  const updateResults: Array<Connection[] | Error> = [];
  const lockedReads: Connection[][] = [];
  const insertedRows = vi.fn().mockImplementation(async () => [row]);
  const insert = vi.fn().mockImplementation(() => ({
    values: (values: Partial<Connection>) => {
      Object.assign(row, values);
      return { returning: insertedRows };
    },
  }));
  const findFirst = vi.fn().mockImplementation(async () => row);
  const update = vi.fn().mockImplementation(() => ({
    set: (patch: Partial<Connection>) => ({
      where: () => {
        let result: Promise<Connection[]> | undefined;
        const settle = () => {
          result ??= Promise.resolve().then(() => {
            writes.push(patch);
            const configured = updateResults.shift();
            if (configured instanceof Error) throw configured;
            if (configured !== undefined && configured.length === 0) return [];
            Object.assign(row, patch);
            return configured ?? [row];
          });
          return result;
        };
        const pending = settle();
        return Object.assign(pending, { returning: () => pending });
      },
    }),
  }));
  const select = vi.fn().mockImplementation(() => {
    const query = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      for: vi.fn().mockImplementation(async () => lockedReads.shift() ?? [row]),
    };
    return query;
  });
  const db = {
    query: { financeAccountConnections: { findFirst } },
    update,
    insert,
    select,
    transaction: async (operation: (tx: Database) => Promise<unknown>) =>
      operation(db as unknown as Database),
  };
  const getHostedLinkResult = vi.fn().mockResolvedValue({ publicTokens: [] });
  const exchangePublicToken = vi
    .fn()
    .mockResolvedValue({ accessToken: "synthetic-access", itemId: "synthetic-item" });
  const createHostedLink = vi.fn();
  const persist = vi.fn().mockResolvedValue([{ id: "saved-account" }]);
  const preparePersistence = vi.fn().mockResolvedValue(persist);
  const getConnection = vi.fn().mockImplementation(async () => ({
    data: {
      id: row.id,
      status: row.status,
      externalHandoff: row.externalHandoffUrl ? { url: row.externalHandoffUrl } : null,
      lastError: row.lastError,
    },
    communication: { headline: "Source receipt", optionalDetails: [], requiredDisclosures: [] },
  }));
  const log = vi.fn();
  const options: Options = {
    db: db as unknown as Database,
    now: () => at,
    encryptionKey: key,
    log,
    plaid: {
      getHostedLinkResult,
      exchangePublicToken,
      createHostedLink,
    } as unknown as NonNullable<Options["plaid"]>,
    accounts: { getConnection } as unknown as Options["accounts"],
    preparePersistence,
  };
  return {
    row,
    writes,
    updateResults,
    lockedReads,
    findFirst,
    update,
    insert,
    insertedRows,
    select,
    getHostedLinkResult,
    exchangePublicToken,
    createHostedLink,
    persist,
    preparePersistence,
    getConnection,
    log,
    options,
    service: createFinanceConnectionHandoffService(options),
  };
}

describe("Finance hosted connection completion unit contracts", () => {
  it("refuses known duplicate hosted consent before exchanging its public token", async () => {
    const test = harness();
    test.getHostedLinkResult.mockResolvedValue({
      publicTokens: ["duplicate-token"],
      accountMetadata: {
        "duplicate-token": {
          institutionId: "ins-fixture",
          accounts: [{ name: "Checking", mask: "0042" }],
        },
      },
    });
    const findDuplicateAccounts = vi.fn().mockResolvedValue(["local-existing-account"]);
    const service = createFinanceConnectionHandoffService({
      ...test.options,
      findDuplicateAccounts,
    });
    await expect(service.complete(test.row.id, context)).rejects.toMatchObject({
      code: "conflict",
      details: { reason: "duplicate_bank_accounts" },
    });
    expect(test.exchangePublicToken).not.toHaveBeenCalled();
    expect(test.row.status).toBe("failed");
    expect(findDuplicateAccounts).toHaveBeenCalledWith(context.userId, [
      { institutionId: "ins-fixture", name: "Checking", mask: "0042" },
    ]);
  });

  it("returns a provider URL only after storing its encrypted waiting state, and does not repeat the request on receipt replay", async () => {
    const test = harness({ externalHandoffUrl: null, encryptedHandoffState: null });
    test.createHostedLink.mockResolvedValue({
      url: "https://provider.example.test/synthetic-new",
      expiresAt: "2026-10-18T13:00:00Z",
      linkToken: "synthetic-link",
    });
    const input = { provider: "plaid" as const, idempotencyKey: "start-once" };
    await expect(test.service.start(input, context)).resolves.toMatchObject({
      outcome: "external_action_required",
      data: {
        connectionId,
        status: "pending",
        externalHandoff: { url: "https://provider.example.test/synthetic-new" },
      },
    });
    expect(test.insert).toHaveBeenCalledOnce();
    expect(test.createHostedLink).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ userId: owner, products: ["transactions"] }),
    );
    expect(test.row.lastError).toBeNull();
    expect(test.row.encryptedHandoffState).toEqual(
      expect.objectContaining({ ciphertext: expect.any(String), version: 1 }),
    );
    expect(JSON.stringify(test.row.encryptedHandoffState)).not.toContain("synthetic-link");
    idempotency.mockResolvedValue({ data: { connectionId } });
    await test.service.start(input, context);
    expect(test.insert).toHaveBeenCalledOnce();
    expect(test.createHostedLink).toHaveBeenCalledOnce();
  });

  it("does not request provider authorization if the new attempt cannot be created", async () => {
    const test = harness();
    test.insertedRows.mockResolvedValue([]);
    await expect(
      test.service.start({ provider: "plaid", idempotencyKey: "missing-attempt" }, context),
    ).rejects.toMatchObject({ code: "internal_error" });
    expect(test.createHostedLink).not.toHaveBeenCalled();
  });

  it.each([
    false,
    true,
  ])("projects a failed handoff honestly when provider completion is %s and redacts diagnostics", async (providerCompleted) => {
    const test = harness({ externalHandoffUrl: null, encryptedHandoffState: null });
    if (providerCompleted) {
      test.createHostedLink.mockResolvedValue({
        url: "https://provider.example.test/synthetic-new",
        expiresAt: "2026-10-18T13:00:00Z",
        linkToken: "synthetic-link",
      });
      test.updateResults.push(new Error("Synthetic database secret"));
    } else test.createHostedLink.mockRejectedValue(new Error("Synthetic provider secret"));
    const code = providerCompleted ? "handoff_persistence_failed" : "provider_handoff_failed";
    await expect(
      test.service.start({ provider: "plaid", idempotencyKey: "failed-handoff" }, context),
    ).resolves.toMatchObject({
      outcome: "failed",
      data: { status: "failed", externalHandoff: null },
      remainingWork: { categories: ["connection_restart"] },
    });
    expect(test.row.lastError).toMatchObject({ code, retryable: false });
    expect(test.createHostedLink).toHaveBeenCalledOnce();
    expect(test.log).toHaveBeenCalledExactlyOnceWith({
      event: "connector_handoff_failed",
      code,
      provider: "plaid",
      category: "unexpected",
      durationMs: expect.any(Number),
      method: "POST",
      path: "/v1/finances/account-connections",
      requestId: "handoff-unit",
      status: 503,
    });
    expect(JSON.stringify(test.log.mock.calls)).not.toMatch(
      /Synthetic (?:database|provider) secret|synthetic-link|https:/,
    );
  });

  it("rejects unauthenticated agent authority before looking up an attempt or contacting its provider", async () => {
    const test = harness();
    const agent = { ...context, actorId: "agent", actorType: "agent" as const };
    await expect(test.service.complete(connectionId, agent)).rejects.toMatchObject({
      code: "forbidden",
    });
    await expect(
      test.service.start({ provider: "plaid", idempotencyKey: "untrusted" }, agent),
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(test.findFirst).not.toHaveBeenCalled();
    expect(test.getHostedLinkResult).not.toHaveBeenCalled();
    expect(test.createHostedLink).not.toHaveBeenCalled();
    expect(test.writes).toEqual([]);
  });

  it("looks up the attempt under the requesting owner and never contacts the provider for an absent attempt", async () => {
    const test = harness();
    test.findFirst.mockResolvedValue(undefined);
    await expect(test.service.complete(connectionId, context)).rejects.toMatchObject({
      code: "not_found",
    });
    const query = new PgDialect().sqlToQuery(test.findFirst.mock.calls[0]?.[0].where);
    expect(query.params).toEqual([connectionId, owner]);
    expect(test.getHostedLinkResult).not.toHaveBeenCalled();
    expect(test.preparePersistence).not.toHaveBeenCalled();
  });

  it("returns an already connected receipt without requiring provider availability or exchanging consent", async () => {
    const test = harness({ status: "connected" });
    const options = { ...test.options };
    delete options.plaid;
    delete options.encryptionKey;
    const service = createFinanceConnectionHandoffService(options);
    await expect(service.complete(connectionId, context)).resolves.toMatchObject({
      data: { status: "connected" },
    });
    expect(test.getConnection).toHaveBeenCalledWith(owner, connectionId);
    expect(test.exchangePublicToken).not.toHaveBeenCalled();
    expect(test.writes).toEqual([]);
  });

  it.each([
    "provider",
    "creation",
    "result",
    "encryption",
  ])("fails closed when the required %s capability is unavailable", async (missing) => {
    const test = harness();
    const options = { ...test.options };
    if (missing === "encryption") delete options.encryptionKey;
    else if (missing === "provider") delete options.plaid;
    else
      options.plaid = {
        ...test.options.plaid,
        [missing === "creation" ? "createHostedLink" : "getHostedLinkResult"]: undefined,
      } as unknown as NonNullable<Options["plaid"]>;
    const service = createFinanceConnectionHandoffService(options);
    await expect(service.complete(connectionId, context)).rejects.toMatchObject({
      code: "service_unavailable",
    });
    expect(test.exchangePublicToken).not.toHaveBeenCalled();
    expect(test.writes).toEqual([]);
  });

  it.each([
    null,
    encryptJson({ phase: "exchanging" }, key),
  ])("does not repeat an interrupted or uncertain exchange", async (encryptedHandoffState) => {
    const test = harness({ encryptedHandoffState });
    await expect(test.service.complete(connectionId, context)).rejects.toMatchObject({
      code: "conflict",
    });
    expect(test.getHostedLinkResult).not.toHaveBeenCalled();
    expect(test.exchangePublicToken).not.toHaveBeenCalled();
    expect(test.preparePersistence).not.toHaveBeenCalled();
  });

  it("rejects malformed retained provider state before a provider request", async () => {
    const test = harness({ encryptedHandoffState: encryptJson({ phase: "unknown" }, key) });
    await expect(test.service.complete(connectionId, context)).rejects.toThrow();
    expect(test.getHostedLinkResult).not.toHaveBeenCalled();
    expect(test.writes).toEqual([]);
  });

  it.each([
    null,
    new Date("2026-10-18T13:00:00Z"),
  ])("keeps unexpired or undated authorization pending without exchanging an absent receipt", async (externalHandoffExpiresAt) => {
    const test = harness({ externalHandoffExpiresAt });
    await expect(test.service.complete(connectionId, context)).resolves.toMatchObject({
      outcome: "external_action_required",
      remainingWork: { categories: ["provider_authorization"], count: 1 },
    });
    expect(test.writes).toEqual([]);
    expect(test.exchangePublicToken).not.toHaveBeenCalled();
  });

  it("expires an uncompleted handoff at the exact boundary and removes its bearer URL", async () => {
    const test = harness({ externalHandoffExpiresAt: at });
    await expect(test.service.complete(connectionId, context)).resolves.toMatchObject({
      outcome: "failed",
      data: { status: "needs_reauth", externalHandoff: null },
      remainingWork: { categories: ["connection_restart"] },
    });
    expect(test.writes).toEqual([
      expect.objectContaining({
        encryptedHandoffState: null,
        externalHandoffUrl: null,
        lastError: expect.objectContaining({ code: "handoff_expired", retryable: false }),
      }),
    ]);
    expect(test.exchangePublicToken).not.toHaveBeenCalled();
  });

  it.each([
    { publicTokens: ["first", "second"] },
    { publicTokens: [""] },
  ])("rejects ambiguous or empty provider consent receipts without consuming a token", async ({
    publicTokens,
  }) => {
    const test = harness();
    test.getHostedLinkResult.mockResolvedValue({ publicTokens });
    await expect(test.service.complete(connectionId, context)).rejects.toMatchObject({
      code: "conflict",
    });
    expect(test.exchangePublicToken).not.toHaveBeenCalled();
    expect(test.preparePersistence).not.toHaveBeenCalled();
    expect(test.writes).toEqual([]);
  });

  it("does not consume provider consent after losing the attempt's completion claim", async () => {
    const test = harness();
    test.getHostedLinkResult.mockResolvedValue({ publicTokens: ["synthetic-public"] });
    test.updateResults.push([]);
    await expect(test.service.complete(connectionId, context)).rejects.toMatchObject({
      code: "conflict",
    });
    expect(test.exchangePublicToken).not.toHaveBeenCalled();
    expect(test.persist).not.toHaveBeenCalled();
  });

  it("marks a failed token exchange uncertain, preserves a redacted repair state and never retries the consumed token", async () => {
    const test = harness();
    test.getHostedLinkResult.mockResolvedValue({ publicTokens: ["synthetic-public"] });
    test.exchangePublicToken.mockRejectedValue(new Error("provider-secret-error"));
    await expect(test.service.complete(connectionId, context)).rejects.toThrow(
      "provider-secret-error",
    );
    expect(test.exchangePublicToken).toHaveBeenCalledOnce();
    expect(test.row.status).toBe("needs_reauth");
    expect(test.row.lastError).toMatchObject({ code: "exchange_uncertain", retryable: false });
    expect(JSON.stringify(test.row.lastError)).not.toContain("provider-secret-error");
    await expect(test.service.complete(connectionId, context)).rejects.toMatchObject({
      code: "conflict",
    });
    expect(test.exchangePublicToken).toHaveBeenCalledOnce();
  });

  it("recovers a retained exchange without requesting or exchanging provider consent again", async () => {
    const test = harness({
      encryptedHandoffState: encryptJson(
        {
          phase: "exchanged",
          accessToken: "synthetic-access",
          itemId: "synthetic-item",
          institution: "Synthetic bank",
        },
        key,
      ),
    });
    await expect(test.service.complete(connectionId, context)).resolves.toMatchObject({
      data: { status: "connected" },
    });
    expect(test.preparePersistence).toHaveBeenCalledWith(
      {
        phase: "exchanged",
        accessToken: "synthetic-access",
        itemId: "synthetic-item",
        institution: "Synthetic bank",
      },
      context,
    );
    expect(test.persist).toHaveBeenCalledOnce();
    expect(test.row.accountIds).toEqual(["saved-account"]);
    expect(test.row.encryptedHandoffState).toBeNull();
    expect(test.row.externalHandoffUrl).toBeNull();
    expect(test.getHostedLinkResult).not.toHaveBeenCalled();
    expect(test.exchangePublicToken).not.toHaveBeenCalled();
  });

  it("retains exchanged credentials and reports a nonretryable authoritative duplicate conflict", async () => {
    const test = harness({
      encryptedHandoffState: encryptJson(
        { phase: "exchanged", accessToken: "synthetic-access", itemId: "synthetic-item" },
        key,
      ),
    });
    test.preparePersistence.mockRejectedValue(
      new AppError("conflict", "Already connected.", {
        reason: "duplicate_bank_accounts",
        accountIds: ["local-account"],
      }),
    );
    await expect(test.service.complete(connectionId, context)).rejects.toMatchObject({
      code: "conflict",
    });
    expect(test.row.status).toBe("failed");
    expect(test.row.lastError).toMatchObject({ code: "duplicate_bank_accounts", retryable: false });
    expect(test.row.encryptedHandoffState).not.toBeNull();
    expect(test.exchangePublicToken).not.toHaveBeenCalled();
  });

  it("retains exchanged credentials for account-persistence recovery while returning the original failure", async () => {
    const test = harness({
      encryptedHandoffState: encryptJson(
        { phase: "exchanged", accessToken: "synthetic-access", itemId: "synthetic-item" },
        key,
      ),
    });
    test.preparePersistence.mockRejectedValue(new Error("Account persistence unavailable"));
    await expect(test.service.complete(connectionId, context)).rejects.toThrow(
      "Account persistence unavailable",
    );
    expect(test.row.status).toBe("pending");
    expect(test.row.lastError).toMatchObject({
      code: "connection_persist_failed",
      retryable: true,
    });
    expect(test.row.encryptedHandoffState).not.toBeNull();
    expect(test.exchangePublicToken).not.toHaveBeenCalled();
  });

  it.each([
    "missing",
    "changed",
  ])("refuses %s connection state under the final persistence lock", async (state) => {
    const test = harness({
      encryptedHandoffState: encryptJson(
        { phase: "exchanged", accessToken: "synthetic-access", itemId: "synthetic-item" },
        key,
      ),
    });
    test.lockedReads.push(
      state === "missing" ? [] : [{ ...test.row, encryptedHandoffState: null }],
    );
    await expect(test.service.complete(connectionId, context)).rejects.toMatchObject({
      code: state === "missing" ? "not_found" : "conflict",
    });
    expect(test.persist).not.toHaveBeenCalled();
    expect(test.exchangePublicToken).not.toHaveBeenCalled();
  });

  it.each([
    1, 2,
  ])("retries exchange-result persistence %s times using the known credentials, never the single-use token", async (failures) => {
    const test = harness();
    test.getHostedLinkResult.mockResolvedValue({
      publicTokens: ["synthetic-public"],
      institutions: { "synthetic-public": "Synthetic bank" },
    });
    test.updateResults.push(
      [test.row],
      ...Array.from({ length: failures }, () => new Error("Database temporarily unavailable")),
    );
    await expect(test.service.complete(connectionId, context)).resolves.toMatchObject({
      data: { status: "connected" },
    });
    expect(test.exchangePublicToken).toHaveBeenCalledExactlyOnceWith("synthetic-public");
    expect(test.preparePersistence).toHaveBeenCalledWith(
      expect.objectContaining({ institution: "Synthetic bank", accessToken: "synthetic-access" }),
      context,
    );
    expect(test.persist).toHaveBeenCalledOnce();
    expect(test.log).not.toHaveBeenCalled();
  });

  it("bounds credential-storage retries, emits redacted diagnostics and requires fresh authorization after exhaustion", async () => {
    const test = harness();
    test.getHostedLinkResult.mockResolvedValue({ publicTokens: ["synthetic-public"] });
    test.updateResults.push(
      [test.row],
      new Error("secret-one"),
      new Error("secret-two"),
      new Error("secret-three"),
    );
    await expect(test.service.complete(connectionId, context)).rejects.toMatchObject({
      code: "service_unavailable",
    });
    expect(test.exchangePublicToken).toHaveBeenCalledOnce();
    expect(test.preparePersistence).not.toHaveBeenCalled();
    expect(test.row.status).toBe("needs_reauth");
    expect(test.row.lastError).toMatchObject({
      code: "exchange_persistence_failed",
      retryable: false,
    });
    expect(test.log).toHaveBeenCalledExactlyOnceWith({
      event: "connector_handoff_failed",
      code: "exchange_persistence_failed",
      provider: "plaid",
      category: "unexpected",
      durationMs: expect.any(Number),
      method: "POST",
      path: "/v1/finances/account-connections/:id/complete",
      requestId: "handoff-unit",
      status: 503,
    });
    expect(JSON.stringify(test.log.mock.calls)).not.toMatch(
      /synthetic-(?:public|access)|secret-(?:one|two|three)|https:/,
    );
    await expect(test.service.complete(connectionId, context)).rejects.toMatchObject({
      code: "conflict",
    });
    expect(test.exchangePublicToken).toHaveBeenCalledOnce();
  });

  it("accepts another completion that won the final lock without saving duplicate accounts", async () => {
    const test = harness({
      encryptedHandoffState: encryptJson(
        { phase: "exchanged", accessToken: "synthetic-access", itemId: "synthetic-item" },
        key,
      ),
    });
    test.lockedReads.push([{ ...test.row, status: "connected" }]);
    await test.service.complete(connectionId, context);
    expect(test.persist).not.toHaveBeenCalled();
    expect(test.writes).toEqual([]);
    expect(test.getConnection).toHaveBeenCalledWith(owner, connectionId);
  });

  it("requires recovery when exchange-result writes no longer match the claimed connection version", async () => {
    const test = harness();
    test.getHostedLinkResult.mockResolvedValue({ publicTokens: ["synthetic-public"] });
    test.updateResults.push([test.row], [], [], []);
    await expect(test.service.complete(connectionId, context)).rejects.toMatchObject({
      code: "service_unavailable",
    });
    expect(test.exchangePublicToken).toHaveBeenCalledOnce();
    expect(test.preparePersistence).not.toHaveBeenCalled();
    expect(test.persist).not.toHaveBeenCalled();
    expect(test.row.lastError).toMatchObject({
      code: "exchange_persistence_failed",
      retryable: false,
    });
    expect(test.writes).toHaveLength(5);
  });

  it.each([
    {
      status: "connected",
      code: null,
      outcome: "completed",
      category: null,
      headline: "Bank connection completed.",
    },
    {
      status: "failed",
      code: "provider_handoff_failed",
      outcome: "failed",
      category: "connection_restart",
      headline: "Provider request unavailable",
    },
    {
      status: "pending",
      code: "handoff_creation_pending",
      outcome: "work_remaining",
      category: "handoff_creation",
      headline: "Provider request unavailable",
    },
    {
      status: "pending",
      code: null,
      outcome: "work_remaining",
      category: "connection_recovery",
      headline: "Bank authorization is unavailable.",
    },
  ])("projects current $status receipt as $outcome without inventing an authorization URL", async ({
    status,
    code,
    outcome,
    category,
    headline,
  }) => {
    const test = harness({ externalHandoffUrl: null });
    test.getConnection.mockResolvedValue({
      data: {
        status,
        externalHandoff: null,
        lastError: code ? { code, message: "Provider request unavailable" } : null,
      },
      communication: { headline: "Old headline", optionalDetails: [], requiredDisclosures: [] },
    });
    await expect(test.service.complete(connectionId, context)).resolves.toMatchObject({
      outcome,
      communication: { headline: expect.stringContaining(headline) },
      remainingWork: { categories: category ? [category] : [], count: category ? 1 : 0 },
    });
    expect(test.exchangePublicToken).not.toHaveBeenCalled();
  });
});
