import { auditEvents, textingConnections } from "@personal-os/database";
import { eq } from "drizzle-orm";
import { encryptJson } from "../../apps/api/src/security.js";
import { createMcpWorkspaceFixture, type WorkspaceFixture } from "./fixture.js";

describe("workspace controls through MCP", () => {
  let f: WorkspaceFixture;
  beforeAll(async () => {
    f = await createMcpWorkspaceFixture();
  }, 120_000);
  afterAll(async () => {
    await f?.close();
  });
  it.each([
    "mail",
    "calendar",
    "tasks",
    "finances",
  ] as const)("reads and updates %s preferences with revision checks", async (workspace) => {
    await f.setBypass(true);
    const { client } = await f.connectAgent([
      `${workspace}:read`,
      `${workspace}:write`,
      `${workspace}:execute`,
      ...(workspace === "tasks" ? ["reminders:read" as const] : []),
    ]);
    const read = await client.callTool({
      name: `get_${workspace === "finances" ? "finance" : workspace === "tasks" ? "task" : workspace}_settings`,
      arguments: {},
    });
    expect(read.isError, JSON.stringify(read)).not.toBe(true);
    const original = (read.structuredContent as { result: { revision: number } }).result;
    const args = {
      expectedRevision: original.revision,
      preferences: { includeArchivedInSearch: false },
    };
    const changed = await client.callTool({
      name: `update_${workspace === "finances" ? "finance" : workspace === "tasks" ? "task" : workspace}_settings`,
      arguments: args,
    });
    expect(changed.isError, JSON.stringify(changed)).not.toBe(true);
    const saved = await client.callTool({
      name: `get_${workspace === "finances" ? "finance" : workspace === "tasks" ? "task" : workspace}_settings`,
      arguments: {},
    });
    expect(saved.structuredContent).toMatchObject({
      result: { revision: original.revision + 1, preferences: { includeArchivedInSearch: false } },
    });
    const stale = await client.callTool({
      name: `update_${workspace === "finances" ? "finance" : workspace === "tasks" ? "task" : workspace}_settings`,
      arguments: args,
    });
    expect(stale.isError).toBe(true);
    const search = await client.callTool({
      name: `search_${workspace === "finances" ? "finance" : workspace}`,
      arguments: { q: "fixture", limit: 10 },
    });
    expect(search.isError, JSON.stringify(search)).not.toBe(true);
    const note = await client.callTool({
      name: "create_attention_item",
      arguments: {
        domain: workspace,
        kind: "important",
        title: "Fixture attention",
        summary: "Persisted through MCP",
      },
    });
    expect(note.isError, JSON.stringify(note)).not.toBe(true);
    const item = (note.structuredContent as { result: { id: string; version: number } }).result;
    const listed = await client.callTool({
      name: "list_attention_items",
      arguments: { domain: workspace },
    });
    expect(listed.isError, JSON.stringify(listed)).not.toBe(true);
    expect(JSON.stringify(listed)).toContain(item.id);
    const resolved = await client.callTool({
      name: "update_attention_item",
      arguments: {
        domain: workspace,
        id: item.id,
        expectedVersion: item.version,
        status: "resolved",
      },
    });
    expect(resolved.isError, JSON.stringify(resolved)).not.toBe(true);
    expect(resolved.structuredContent).toMatchObject({ result: { status: "resolved" } });
  });
});

describe("notification controls through MCP", () => {
  let f: WorkspaceFixture;
  beforeAll(async () => {
    f = await createMcpWorkspaceFixture();
  }, 120_000);
  afterAll(async () => {
    await f?.close();
  });
  it("preserves inheritance and the owner privacy ceiling", async () => {
    await f.setBypass(true);
    const { client } = await f.connectAgent([
      "texting:read",
      "texting:write",
      "texting:execute",
      "finances:read",
    ]);
    async function call(name: string, args: Record<string, unknown> = {}) {
      const r = await client.callTool({ name, arguments: args });
      expect(r.isError, JSON.stringify(r)).not.toBe(true);
      return (r.structuredContent as { result: Record<string, unknown> }).result;
    }
    await call("get_notification_settings");
    const preferences = {
      enabled: true,
      quietMode: "window",
      quietStartMinute: 1320,
      quietEndMinute: 480,
      reminderDays: 7,
      detail: "minimal",
    };
    const global = await call("update_notification_settings", {
      scope: "global",
      expectedRevision: null,
      preferences,
    });
    const denied = await client.callTool({
      name: "update_notification_settings",
      arguments: {
        scope: "global",
        expectedRevision: global.revision,
        preferences: { ...preferences, detail: "context" },
      },
    });
    expect(denied.isError).toBe(true);
    const override = await call("update_notification_settings", {
      scope: "finances",
      expectedRevision: null,
      preferences: { ...preferences, enabled: false },
    });
    expect(
      await call("reset_finance_notification_settings", { expectedRevision: override.revision }),
    ).toEqual({ scope: "finances", inherited: true });
  });
});

describe("Texting destination disconnection through MCP", () => {
  let f: WorkspaceFixture;
  beforeAll(async () => {
    f = await createMcpWorkspaceFixture();
  }, 120_000);
  afterAll(async () => {
    await f?.close();
  });
  it("requires explicit consent authority and records the agent that disconnected", async () => {
    const [connection] = await f.db
      .insert(textingConnections)
      .values({
        userId: f.owner.id,
        encryptedPhoneNumber: encryptJson("+12025550123", f.config.encryptionKey),
        phoneFingerprint: "fixture-fingerprint",
        phoneLastFour: "0123",
        country: "US",
        consentVersion: "fixture",
        verifiedAt: new Date(),
      })
      .returning();
    const { client, credential } = await f.connectAgent([
      "texting:read",
      "texting:write",
      "texting:execute",
    ]);
    expect((await client.callTool({ name: "disconnect_texting", arguments: {} })).isError).toBe(
      true,
    );
    await f.setBypass(true);
    const response = await client.callTool({ name: "disconnect_texting", arguments: {} });
    expect(response.isError, JSON.stringify(response)).not.toBe(true);
    expect(
      await f.db.query.textingConnections.findFirst({
        where: eq(textingConnections.id, connection!.id),
      }),
    ).toMatchObject({ state: "disconnected" });
    expect(
      await f.db.query.auditEvents.findMany({ where: eq(auditEvents.entityId, connection!.id) }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actorId: credential.id,
          actorType: "agent",
          action: "texting.disconnected",
        }),
      ]),
    );
  });
});
