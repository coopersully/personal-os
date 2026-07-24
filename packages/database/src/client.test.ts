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
});
