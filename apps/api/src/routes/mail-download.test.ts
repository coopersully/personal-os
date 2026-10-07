import { Hono } from "hono";
import { errorResponse } from "../errors.js";
import type { createMailService } from "../mail-service.js";
import type { AppEnv, Principal } from "../types.js";
import { registerMailRoutes } from "./mail.js";

it("rejects overlapping downloads before provider I/O and releases the slot afterward", async () => {
  const principal: Principal = {
    userId: crypto.randomUUID(),
    actorId: "test",
    actorType: "user",
    scopes: new Set(["mail:read"]),
  };
  const app = new Hono<AppEnv>();
  app.use("*", async (c, next) => {
    c.set("principal", principal);
    c.set("requestId", "test");
    await next();
  });
  app.onError(errorResponse);
  let resolve!: (value: unknown) => void;
  let started!: () => void;
  const ready = new Promise<void>((r) => {
    started = r;
  });
  const downloadAttachment = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
          started();
        }),
    )
    .mockResolvedValue({ data: "YQ==" });
  registerMailRoutes({
    app,
    mail: { downloadAttachment } as unknown as ReturnType<typeof createMailService>,
    mutationContext: () => ({ principal, requestId: "test" }),
  });
  const url = "/v1/mail/messages/message/attachments/attachment";
  const first = app.request(url);
  await ready;
  const second = await app.request(url);
  expect(second.status).toBe(429);
  expect(downloadAttachment).toHaveBeenCalledTimes(1);
  resolve({ data: "YQ==" });
  expect((await first).status).toBe(200);
  const third = await app.request(url);
  expect(third.status).toBe(200);
  expect(third.headers.get("Cache-Control")).toBe("no-store");
});

it("passes request cancellation to the download and releases the user's slot after it stops", async () => {
  const principal: Principal = {
    userId: crypto.randomUUID(),
    actorId: "test",
    actorType: "user",
    scopes: new Set(["mail:read"]),
  };
  const app = new Hono<AppEnv>();
  app.use("*", async (context, next) => {
    context.set("principal", principal);
    context.set("requestId", "cancel-download");
    await next();
  });
  app.onError(errorResponse);
  let started!: () => void;
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  let downloadSignal: AbortSignal | undefined;
  const stopped = vi.fn();
  const downloadAttachment = vi
    .fn()
    .mockImplementationOnce((_userId, _messageId, _attachmentId, signal: AbortSignal) => {
      downloadSignal = signal;
      return new Promise((_resolve, reject) => {
        signal.addEventListener(
          "abort",
          () => {
            stopped();
            reject(signal.reason);
          },
          { once: true },
        );
        started();
      });
    })
    .mockResolvedValue({ data: "YQ==" });
  registerMailRoutes({
    app,
    mail: { downloadAttachment } as unknown as ReturnType<typeof createMailService>,
    mutationContext: () => ({ principal, requestId: "cancel-download" }),
  });
  const controller = new AbortController();
  const url = "/v1/mail/messages/message/attachments/attachment";
  const first = app.request(url, { signal: controller.signal });
  await ready;
  expect((await app.request(url)).status).toBe(429);
  controller.abort();
  await first;
  expect(downloadSignal?.aborted).toBe(true);
  expect(stopped).toHaveBeenCalledOnce();
  expect((await app.request(url)).status).toBe(200);
  expect(downloadAttachment).toHaveBeenCalledTimes(2);
});
