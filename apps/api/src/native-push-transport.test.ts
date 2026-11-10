import { generateKeyPairSync } from "node:crypto";
import { EventEmitter } from "node:events";
import { classifyApnsResponse, createApnsTransport } from "./native-push-transport.js";

const mocks = vi.hoisted(() => ({ connect: vi.fn() }));
vi.mock("node:http2", () => ({ connect: mocks.connect }));
describe("direct APNs boundary", () => {
  const key = generateKeyPairSync("ec", { namedCurve: "prime256v1" })
    .privateKey.export({ type: "pkcs8", format: "pem" })
    .toString();
  const config = {
    enabled: true,
    privateKey: key,
    teamId: "TESTTEAM00",
    keyId: "TESTKEY000",
    topic: "app.personal-os.mobile",
    environment: "production" as const,
  };
  const input = {
    token: "ab".repeat(32),
    id: "12345678-1234-1234-1234-123456789000",
    payload: {
      aps: {
        alert: { title: "nohmi", body: "You have a Finance update." },
        sound: "default" as const,
      },
      version: 1 as const,
      kind: "finance" as const,
      eventId: "event",
      audience: "audience",
    },
  };
  function socket(status = 200, body = "") {
    const session = new EventEmitter() as EventEmitter & {
      destroy: ReturnType<typeof vi.fn>;
      request: ReturnType<typeof vi.fn>;
    };
    const stream = new EventEmitter() as EventEmitter & { end: ReturnType<typeof vi.fn> };
    session.destroy = vi.fn();
    session.request = vi.fn(() => stream);
    stream.end = vi.fn(() =>
      queueMicrotask(() => {
        stream.emit("response", { ":status": status });
        stream.emit("data", Buffer.from(body));
        stream.emit("end");
      }),
    );
    mocks.connect.mockImplementation(() => {
      queueMicrotask(() => session.emit("connect"));
      return session;
    });
    return { session, stream };
  }
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });
  it.each([
    [200, undefined, "accepted"],
    [410, "Unregistered", "invalid_token"],
    [400, "BadDeviceToken", "invalid_token"],
    [400, "DeviceTokenNotForTopic", "invalid_token"],
    [429, undefined, "retryable"],
    [500, undefined, "retryable"],
    [503, undefined, "retryable"],
    [403, "InvalidProviderToken", "failed"],
  ] as const)("classifies %s/%s", (status, reason, result) =>
    expect(classifyApnsResponse(status, reason)).toBe(result));
  it("sends HTTP2 bearer ES256 with generic payload and a stable correlation ID", async () => {
    const { session, stream } = socket();
    const transport = createApnsTransport(config);
    expect(await transport(input)).toBe("accepted");
    const headers = session.request.mock.calls[0]?.[0];
    expect(headers).toMatchObject({
      "apns-id": input.id,
      "apns-topic": config.topic,
      "apns-expiration": expect.any(String),
      "apns-push-type": "alert",
    });
    expect(headers.authorization).toMatch(/^bearer [\w-]+\.[\w-]+\.[\w-]+$/);
    expect(Number(headers["apns-expiration"])).toBeGreaterThan(Math.floor(Date.now() / 1000));
    expect(stream.end).toHaveBeenCalledWith(JSON.stringify(input.payload));
    expect(session.destroy).toHaveBeenCalled();
    socket(503, '{"reason":"ServiceUnavailable"}');
    expect(await transport(input)).toBe("retryable");
  });
  it("fences timeout and network errors as uncertain", async () => {
    vi.useFakeTimers();
    const { session, stream } = socket();
    stream.end.mockImplementation(() => {});
    const pending = createApnsTransport(config)(input);
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await pending).toBe("uncertain");
    const next = socket();
    next.stream.end.mockImplementation(() => next.session.emit("error", new Error("private")));
    expect(await createApnsTransport(config)(input)).toBe("uncertain");
    expect(session.destroy).toHaveBeenCalled();
  });
  it("fails closed for disabled or invalid signing material", async () => {
    expect(await createApnsTransport({ ...config, enabled: false })(input)).toBe("failed");
    expect(await createApnsTransport({ ...config, privateKey: "bad" })(input)).toBe("failed");
    expect(mocks.connect).not.toHaveBeenCalled();
  });
  it("uses sandbox only when explicitly configured, bounds responses and preserves explicit status on malformed body", async () => {
    socket(400, "bad");
    expect(await createApnsTransport({ ...config, environment: "sandbox" })(input)).toBe("failed");
    expect(mocks.connect).toHaveBeenCalledWith("https://api.sandbox.push.apple.com");
    socket(400, "x".repeat(4097));
    expect(await createApnsTransport(config)(input)).toBe("uncertain");
  });
  it("contains a synchronous HTTP2 request error inside the connect callback", async () => {
    const { session } = socket();
    session.request.mockImplementation(() => {
      throw new Error("closed");
    });
    expect(await createApnsTransport(config)(input)).toBe("uncertain");
  });
  it("does not submit a request when HTTP2 connects after the deadline", async () => {
    vi.useFakeTimers();
    const { session } = socket();
    mocks.connect.mockReturnValue(session);
    const pending = createApnsTransport(config)(input);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await pending).toBe("uncertain");
    session.emit("connect");
    expect(session.request).not.toHaveBeenCalled();
    expect(session.destroy).toHaveBeenCalledOnce();
  });
});
