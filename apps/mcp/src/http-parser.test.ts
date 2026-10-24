import { type ClientRequest, request, type Server } from "node:http";
import { deflateSync, gzipSync } from "node:zlib";
import express from "express";

function post(server: Server, body: Buffer): Promise<number> {
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("HTTP peer did not bind.");
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: "127.0.0.1",
        port: address.port,
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-encoding": "gzip",
          "content-length": body.length,
        },
      },
      (response) => {
        response.resume();
        response.on("end", () => resolve(response.statusCode ?? 0));
      },
    );
    req.on("error", reject);
    req.end(body);
  });
}

describe("MCP Express JSON dependency boundary", () => {
  it("drains bytes arriving after the decoder finishes without stranding the request", async () => {
    const app = express();
    const trailing = Buffer.alloc(1024);
    let client: ClientRequest;
    app.use(express.json({ limit: "100kb" }));
    app.post("/", (req, res) => {
      expect(req.body).toEqual({ method: "initialize" });
      // The frame has already decoded; delay the rest of the HTTP body until now.
      req.once("end", () => res.sendStatus(204));
      client.end(trailing);
    });
    const server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve, reject) => {
      server.once("listening", resolve);
      server.once("error", reject);
    });
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("HTTP peer did not bind.");
      const first = Buffer.concat([
        deflateSync(JSON.stringify({ method: "initialize" })),
        Buffer.from([0]),
      ]);
      const status = await new Promise<number>((resolve, reject) => {
        client = request(
          {
            host: "127.0.0.1",
            port: address.port,
            method: "POST",
            agent: false,
            headers: {
              "content-type": "application/json",
              "content-encoding": "deflate",
              "content-length": first.length + trailing.length,
            },
          },
          (response) => {
            response.resume();
            response.once("end", () => resolve(response.statusCode ?? 0));
          },
        );
        client.once("error", reject);
        client.setTimeout(1000, () => client.destroy(new Error("Request body was not drained")));
        client.write(first);
      });
      expect(status).toBe(204);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it("survives trailing bytes after compressed JSON and accepts the next request", async () => {
    const app = express();
    // Match the MCP entry point's parser without starting its authenticated service.
    app.use(express.json({ limit: "100kb" }));
    app.post("/", (_req, res) => res.sendStatus(204));
    app.use(
      (
        error: unknown,
        _req: express.Request,
        res: express.Response,
        _next: express.NextFunction,
      ) => {
        expect(error).toBeTruthy();
        res.sendStatus(400);
      },
    );
    const server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve, reject) => {
      server.once("listening", resolve);
      server.once("error", reject);
    });
    try {
      const compressed = gzipSync(JSON.stringify({ method: "initialize" }));
      expect(await post(server, Buffer.concat([compressed, Buffer.from("trailing junk")]))).toBe(
        400,
      );
      expect(
        await post(
          server,
          Buffer.concat([compressed, Buffer.from([0]), Buffer.alloc(100 * 1024, 0x58)]),
        ),
      ).toBe(204);
      // Allow a decoder error emitted after the response to surface in the test runner.
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(await post(server, compressed)).toBe(204);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
});
