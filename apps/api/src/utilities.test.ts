import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { requireDatabaseRecord } from "./database.js";
import { AppError, errorResponse, isUniqueViolation } from "./errors.js";
import { createOpenApiDocument } from "./openapi.js";
import { decodeCursor, encodeCursor } from "./pagination.js";
import {
  decryptJson,
  encryptJson,
  generateInvitationCode,
  generateToken,
  hashPassword,
  hashToken,
  verifyPassword,
} from "./security.js";

const key = Buffer.alloc(32, 7).toString("base64");

describe("security utilities", () => {
  it("hashes and verifies passwords and opaque tokens", async () => {
    const password = await hashPassword("LocalTestOnly123!");
    expect(password).toMatch(/^scrypt\$/);
    await expect(verifyPassword("LocalTestOnly123!", password)).resolves.toBe(true);
    await expect(verifyPassword("wrong", password)).resolves.toBe(false);
    for (const malformed of ["bad", "scrypt$$digest", "scrypt$salt$", "scrypt$salt$digest$extra"]) {
      await expect(verifyPassword("x", malformed)).resolves.toBe(false);
    }
    expect(generateToken("pos")).toMatch(/^pos_[A-Za-z0-9_-]{43}$/);
    expect(generateInvitationCode()).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
    expect(hashToken("same")).toBe(hashToken("same"));
    expect(hashToken("same")).not.toBe(hashToken("other"));
  });

  it("round-trips encrypted JSON and rejects invalid keys and versions", () => {
    const encrypted = encryptJson({ refreshToken: "secret", count: 2 }, key);
    expect(encrypted.version).toBe(1);
    expect(decryptJson(encrypted, key)).toEqual({ refreshToken: "secret", count: 2 });
    expect(() => encryptJson({}, "bad")).toThrow("base64-encoded 32-byte key");
    expect(() => decryptJson({ ...encrypted, version: 2 as 1 }, key)).toThrow("Unsupported");
  });
});

describe("pagination, errors, and OpenAPI", () => {
  it("enforces database mutation return invariants", () => {
    expect(requireDatabaseRecord({ id: "record" }, "Missing")).toEqual({ id: "record" });
    expect(() => requireDatabaseRecord(undefined, "Missing database record")).toThrow(
      "Missing database record",
    );
  });

  it("round-trips valid cursors and rejects every malformed shape", () => {
    const cursor = {
      createdAt: new Date("2026-07-13T12:00:00Z"),
      id: "11111111-1111-4111-8111-111111111111",
    };
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
    for (const value of [
      "",
      Buffer.from("not-a-date|11111111-1111-4111-8111-111111111111").toString("base64url"),
      Buffer.from("date-only").toString("base64url"),
      Buffer.from("2026-07-13T12:00:00Z||").toString("base64url"),
      Buffer.from("2026-07-13T12:00:00Z|not-a-uuid").toString("base64url"),
      Buffer.from("2026-07-13T12:00:00Z|11111111-1111-4111-8111-111111111111|extra").toString(
        "base64url",
      ),
    ]) {
      expect(() => decodeCursor(value)).toThrow("pagination cursor is invalid");
    }
  });

  it("classifies unique violations", () => {
    expect(isUniqueViolation({ code: "23505" })).toBe(true);
    expect(isUniqueViolation({ cause: { code: "23505" } })).toBe(true);
    expect(
      isUniqueViolation(
        { cause: { code: "23505", constraint: "domain_profiles_user_domain_idx" } },
        "domain_profiles_user_domain_idx",
      ),
    ).toBe(true);
    expect(
      isUniqueViolation(
        { code: "23505", constraint: "unrelated_idx" },
        "domain_profiles_user_domain_idx",
      ),
    ).toBe(false);
    const cyclic: { cause?: unknown } = {};
    cyclic.cause = cyclic;
    expect(isUniqueViolation(cyclic)).toBe(false);
    expect(isUniqueViolation({ code: "other" })).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
    expect(isUniqueViolation("23505")).toBe(false);
  });

  it("serializes all public error families", async () => {
    const json = vi.fn((body: unknown, status: number) => Response.json(body, { status }));
    const context = { get: () => "request-1", json };
    const appWithoutDetails = new AppError("not_found", "Missing");
    expect(appWithoutDetails.status).toBe(404);
    expect(appWithoutDetails.name).toBe("AppError");
    expect((await errorResponse(appWithoutDetails, context as never).json()).error).toMatchObject({
      code: "not_found",
      requestId: "request-1",
    });
    expect(
      (
        await errorResponse(
          new AppError("conflict", "Conflict", { field: "email" }),
          context as never,
        ).json()
      ).error.details,
    ).toEqual({ field: "email" });
    const zodError = z.object({ value: z.string() }).safeParse({ value: 1 });
    if (zodError.success) throw new Error("Expected Zod failure");
    expect(errorResponse(zodError.error, context as never).status).toBe(400);
    expect(
      (await errorResponse(new HTTPException(404, { message: "Route" }), context as never).json())
        .error.code,
    ).toBe("not_found");
    expect(
      (await errorResponse(new HTTPException(405, { message: "Method" }), context as never).json())
        .error.code,
    ).toBe("invalid_request");
    expect((await errorResponse(new Error("secret"), context as never).json()).error.message).toBe(
      "An unexpected error occurred.",
    );
  });

  it("publishes the configured API surface", () => {
    const document = createOpenApiDocument("https://api.example.com");
    expect(document.openapi).toBe("3.1.0");
    expect(document.paths["/v1/assistant/setup-plan"].get.responses[200].description).toBe(
      "Current server-owned agent setup plan",
    );
    expect(document.servers).toEqual([{ url: "https://api.example.com" }]);
    expect(Object.keys(document.paths)).toContain("/v1/connectors/{id}/sync");
    expect(document.paths["/v1/calendars/commitments/preview"]).toEqual({
      post: {
        security: [{ bearerAuth: [] }, { cookieAuth: [] }, { sessionAuth: [] }],
        responses: { 200: { description: "Calendar commitment proposal preview" } },
      },
    });
    expect(document.paths["/v1/events/{id}/attention"]).toEqual({
      put: {
        security: [{ bearerAuth: [] }, { cookieAuth: [] }, { sessionAuth: [] }],
        responses: { 200: { description: "Calendar event attention item created or refreshed" } },
      },
    });
    expect(document.paths["/v1/events/{id}/trash"]).toEqual({
      post: {
        security: [{ bearerAuth: [] }, { cookieAuth: [] }, { sessionAuth: [] }],
        responses: { 200: { description: "Event trashed with restorable revisions" } },
      },
    });
    expect(document.paths["/v1/events/{id}/blocks/{blockId}/trash"]).toEqual({
      post: {
        security: [{ bearerAuth: [] }, { cookieAuth: [] }, { sessionAuth: [] }],
        responses: { 200: { description: "Linked calendar block removed with revision guards" } },
      },
    });
    expect(Object.keys(document.paths)).toEqual(
      expect.arrayContaining(["/v1/goals", "/v1/goals/{id}", "/v1/motives", "/v1/motives/{id}"]),
    );
    expect(document.paths["/v1/reminders/{id}"].delete.responses).toEqual({
      204: { description: "Reminder moved to trash" },
    });
    expect(document.paths["/v1/reminders/{id}/trash"].post.responses).toEqual({
      200: { description: expect.stringContaining("Guarded recoverable") },
    });
    expect(document.paths["/v1/reminders/{id}/attention"].put.responses).toEqual({
      200: { description: expect.stringContaining("attention item") },
    });
  });
});
