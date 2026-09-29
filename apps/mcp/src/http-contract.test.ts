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
    expect(metadata).toContain('"finances:maintain"');
  });

  it("validates one explicit application origin at every entry point", async () => {
    const [httpSource, stdioSource] = await Promise.all([
      readFile(new URL("./http.ts", import.meta.url), "utf8"),
      readFile(new URL("./stdio.ts", import.meta.url), "utf8"),
    ]);

    expect(httpSource).toContain("resolveAppBaseUrl(process.env");
    expect(httpSource).toContain('createIloAppLinks(appBaseUrl, "assistant")');
    expect(httpSource).toContain("resource_documentation: appLinks.agentAccess");
    expect(httpSource).not.toContain('APP_BASE_URL ?? "http://localhost:8081"');
    expect(stdioSource).toContain("resolveAppBaseUrl(process.env");
    expect(stdioSource).not.toContain('APP_BASE_URL ?? "http://localhost:8081"');
  });
});
