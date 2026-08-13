import { readFile } from "node:fs/promises";

describe("MCP OAuth resource metadata", () => {
  it("does not advertise the retired automation write authority", async () => {
    const source = await readFile(new URL("./http.ts", import.meta.url), "utf8");
    const metadata = source.slice(
      source.indexOf("const protectedResourceMetadata"),
      source.indexOf('app.get("/.well-known/oauth-protected-resource"'),
    );

    expect(metadata).toContain('"automations:read"');
    expect(metadata).not.toContain('"automations:write"');
  });
});
