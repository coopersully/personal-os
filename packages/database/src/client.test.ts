import { once } from "node:events";
import { createServer, type Socket } from "node:net";
import { createDatabaseClient } from "./client.js";

describe("database client", () => {
  it("accepts a structured pool configuration", async () => {
    const client = createDatabaseClient({
      database: "personal_os",
      host: "127.0.0.1",
      max: 1,
      password: "personal_os",
      port: 65_534,
      user: "personal_os",
    });
    expect(client.db).toBeDefined();
    expect(client.pool.options.max).toBe(1);
    await client.close();
  });

  it("connects to an explicit transport host while retaining the logical TLS hostname", async () => {
    const server = createServer();
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Expected a TCP test server.");

    const client = createDatabaseClient(
      `postgresql://app@prod.internal:${address.port}/personal_os?sslmode=verify-full`,
      { connectHost: "127.0.0.1" },
    );
    let acceptedStream: Socket | undefined;
    let stream: Socket | undefined;
    try {
      expect(new URL(client.pool.options.connectionString ?? "").hostname).toBe("prod.internal");
      expect(client.pool.options.stream).toBeTypeOf("function");
      stream = client.pool.options.stream?.() as Socket | undefined;
      if (!stream) throw new Error("Expected a database transport stream.");
      const accepted = once(server, "connection");
      const connected = once(stream, "connect");
      stream.connect(address.port, "prod.internal");
      const [acceptedValues] = await Promise.all([accepted, connected]);
      acceptedStream = acceptedValues[0] as Socket;
      expect(stream.remoteAddress).toBe("127.0.0.1");
    } finally {
      stream?.destroy();
      acceptedStream?.destroy();
      await client.close();
      const closed = once(server, "close");
      server.close();
      await closed;
    }
  });
});
