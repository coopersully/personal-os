import { createHmac } from "node:crypto";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import twilio from "twilio";
import { describe, expect, it } from "vitest";
import { createTwilioConnector } from "./twilio.js";

const require = createRequire(import.meta.url);
// Exercise the dependency actually used by Twilio, without adding a direct qs dependency.
const sdkRequire = createRequire(require.resolve("twilio"));
const qs = sdkRequire("qs") as {
  stringify(value: unknown, options: { arrayFormat: "comma"; encodeValuesOnly: boolean }): string;
};

describe("Twilio runtime dependency boundary", () => {
  it.each([
    false,
    true,
  ])("serializes hostile comma-array values safely (encodeValuesOnly=%s)", (encodeValuesOnly) => {
    const values = [{ toString: "not callable" }, Object.assign(Object.create(null), { b: "c" })];
    for (const value of values) {
      const encoded = qs.stringify({ a: [value] }, { arrayFormat: "comma", encodeValuesOnly });
      expect(new URLSearchParams(encoded).get("a")).toBe("[object Object]");
    }
  });

  it("keeps the real SDK's repeated form fields and Unicode intact over loopback HTTP", async () => {
    let received = "";
    const server = createServer((req, res) => {
      req.setEncoding("utf8");
      req.on("data", (chunk: string) => {
        received += chunk;
      });
      req.on("end", () => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ sid: "fixture" }));
      });
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Twilio fixture did not bind.");
      const client = new twilio.RequestClient({ timeout: 1000, keepAlive: false });
      const result = await client.request({
        method: "post",
        uri: `http://127.0.0.1:${address.port}/fixture`,
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        data: { Body: "Hello & café 🙂", To: "+15555550100", Tag: ["a,b", "c&d"] },
      });
      expect(result.statusCode).toBe(200);
      const form = new URLSearchParams(received);
      expect(form.get("Body")).toBe("Hello & café 🙂");
      expect(form.get("To")).toBe("+15555550100");
      expect(form.getAll("Tag")).toEqual(["a,b", "c&d"]);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it("preserves real webhook signature acceptance and rejects tampered parameters", () => {
    const token = "synthetic-fixture-token";
    const url = "https://example.test/hooks/twilio";
    const parameters = { Body: "Hello & café 🙂", From: "+15555550100" };
    const material =
      url +
      Object.keys(parameters)
        .sort()
        .map((key) => key + parameters[key as keyof typeof parameters])
        .join("");
    const signature = createHmac("sha1", token).update(material).digest("base64");
    const connector = createTwilioConnector({
      accountSid: `AC${"0".repeat(32)}`,
      authToken: token,
      messagingServiceSid: `MG${"0".repeat(32)}`,
      verifyServiceSid: `VA${"0".repeat(32)}`,
    });
    expect(connector.validateWebhook(signature, url, parameters)).toBe(true);
    expect(connector.validateWebhook(signature, url, { ...parameters, Body: "tampered" })).toBe(
      false,
    );
    expect(connector.validateWebhook(signature, `${url}/other`, parameters)).toBe(false);
  });
});
