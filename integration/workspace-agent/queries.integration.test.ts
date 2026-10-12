import { workspaceMaintenanceRuns } from "@personal-os/database";
import { accessScopeSchema } from "@personal-os/domain";
import { type IloToolName, iloToolCatalog } from "../../apps/mcp/src/tool-catalog.js";
import { createMcpWorkspaceFixture, type WorkspaceFixture } from "./fixture.js";

describe("discovered workspace query execution", () => {
  let f: WorkspaceFixture;
  beforeAll(async () => {
    f = await createMcpWorkspaceFixture();
  }, 120_000);
  afterAll(async () => {
    await f?.close();
  });
  it("traverses populated Finance maintenance history without repeating its first page", async () => {
    await f.db.insert(workspaceMaintenanceRuns).values(
      [1, 2, 3].map((index) => ({
        userId: f.owner.id,
        domain: "finances" as const,
        rulebookVersion: "fixture",
        scope: { type: "all_outstanding" as const },
        status: "failed_terminal" as const,
        createdAt: new Date(`2026-10-0${index}T15:00:00Z`),
      })),
    );
    const { client } = await f.connectAgent(["finances:read"]);
    const ids: string[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 3; page++) {
      const response = await client.callTool({
        name: "get_finance_maintenance_history",
        arguments: { limit: 1, status: "failed_terminal", ...(cursor ? { cursor } : {}) },
      });
      expect(response.isError, JSON.stringify(response)).not.toBe(true);
      const data = (
        response.structuredContent as {
          data: { items: Array<{ run: { id: string } }>; nextCursor: string | null };
        }
      ).data;
      expect(data.items).toHaveLength(1);
      ids.push(data.items[0]!.run.id);
      cursor = data.nextCursor;
    }
    expect(new Set(ids).size).toBe(3);
    expect(cursor).toBeNull();
  });
  it("starts durable Finance maintenance and reads back its accepted run", async () => {
    await f.setBypass(true);
    const { client } = await f.connectAgent([
      "finances:read",
      "finances:maintain",
      "finances:write",
      "finances:execute",
    ]);
    const account = await client.callTool({
      name: "create_finance_account",
      arguments: {
        name: "Maintenance cash",
        institution: "Cash",
        provider: "manual",
        balance: 1000,
      },
    });
    expect(account.isError, JSON.stringify(account)).not.toBe(true);
    const response = await client.callTool({
      name: "maintain_finances",
      arguments: { operation: "start" },
    });
    expect(response.isError, JSON.stringify(response)).not.toBe(true);
    const { data } = response.structuredContent as { data: { run: { id: string } } };
    expect(data.run.id).toBeTruthy();
    const read = await client.callTool({
      name: "get_finance_maintenance_run",
      arguments: { runId: data.run.id },
    });
    expect(read.isError, JSON.stringify(read)).not.toBe(true);
    expect(JSON.stringify(read)).toContain(data.run.id);
    await f.app.dispatchDueFinanceMaintenance();
    const progressed = await client.callTool({
      name: "get_finance_maintenance_run",
      arguments: { runId: data.run.id },
    });
    expect(progressed.isError, JSON.stringify(progressed)).not.toBe(true);
    expect(progressed.structuredContent).toMatchObject({
      result: {
        run: {
          status: "blocked",
          settledResult: { code: "finance_position_evidence_unavailable" },
        },
      },
    });
  });
  it("executes every zero-required-input read against the authenticated migrated database", async () => {
    const { client } = await f.connectAgent(
      accessScopeSchema.options.filter((scope) => scope !== "automations:write"),
    );
    const { tools } = await client.listTools();
    const failures: string[] = [];
    const called: string[] = [];
    for (const tool of tools) {
      const definition = iloToolCatalog[tool.name as IloToolName];
      if (
        !definition.readOnly ||
        !["mail", "calendar", "tasks", "reminders", "finances", "texting", "assistant"].includes(
          definition.domain,
        ) ||
        (tool.inputSchema.required?.length ?? 0) > 0
      )
        continue;
      const response = await client.callTool({ name: tool.name, arguments: {} });
      called.push(tool.name);
      if (response.isError)
        failures.push(
          `${tool.name}: ${JSON.stringify(response.structuredContent ?? response.content)}`,
        );
      expect(response.structuredContent).toBeDefined();
    }
    expect(called.length).toBeGreaterThan(30);
    expect(failures).toEqual([]);
  }, 60_000);
});
