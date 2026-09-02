import type { McpServer } from "@modelcontextprotocol/server";
import { createIloToolSurface } from "./tool-surface.js";

describe("Nomi MCP tool surface", () => {
  it("fails closed when a feature registers an operation missing from the catalog", () => {
    const registerTool = vi.fn();
    const server = { marker: "server", registerTool } as unknown as McpServer;
    const surface = createIloToolSurface(server, {
      appBaseUrl: "https://app.example.com",
      includeCompatibility: false,
      readOnly: false,
      scopes: new Set(),
    }) as unknown as {
      registerTool: (
        name: string,
        config: Record<string, unknown>,
        callback: () => unknown,
      ) => unknown;
    };

    expect(() => surface.registerTool("uncatalogued_finance_tool", {}, () => ({}))).toThrow(
      "missing from the Nomi tool catalog",
    );
    expect(Reflect.get(surface, "marker")).toBe("server");
  });

  it("preserves primitive tool results without fabricating structured metadata", async () => {
    const registerTool = vi.fn();
    const server = { registerTool } as unknown as McpServer;
    const surface = createIloToolSurface(server, {
      appBaseUrl: "https://app.example.com",
      includeCompatibility: false,
      readOnly: false,
      scopes: new Set(["finances:read"]),
    }) as unknown as {
      registerTool: (
        name: string,
        config: Record<string, unknown>,
        callback: () => unknown,
      ) => unknown;
    };

    surface.registerTool("get_finance_status", {}, () => "plain result");
    const wrapped = registerTool.mock.calls[0]?.[2] as (() => Promise<unknown>) | undefined;
    expect(wrapped).toBeDefined();
    await expect(wrapped?.()).resolves.toBe("plain result");
  });
});
