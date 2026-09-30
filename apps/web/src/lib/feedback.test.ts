import { ApiClientError } from "@personal-os/api-client";
import { describe, expect, it } from "vitest";
import { classifyMutationError } from "./feedback.js";

describe("mutation feedback classification", () => {
  it("keeps uncertain writes persistent without exposing diagnostics", () => {
    expect(
      classifyMutationError(new Error("secret SQL"), { action: "create the event" }),
    ).toMatchObject({ persistent: true, kind: "uncertain" });
    expect(
      classifyMutationError(new Error("secret SQL"), { action: "create the event" }).message,
    ).not.toContain("secret");
  });
  it("uses transient feedback only for safe retries outside forms", () => {
    expect(
      classifyMutationError(new Error(), { action: "refresh wallpaper", safeToRetry: true })
        .persistent,
    ).toBe(false);
    expect(
      classifyMutationError(new Error(), { action: "save profile", safeToRetry: true, form: true })
        .persistent,
    ).toBe(true);
  });
  it.each([
    "unauthorized",
    "forbidden",
    "conflict",
    "invalid_request",
    "not_found",
  ])("retains %s blockers", (code) => {
    expect(
      classifyMutationError(new ApiClientError({ code, message: "secret", status: 400 }), {
        action: "save the event",
        safeToRetry: true,
      }).persistent,
    ).toBe(true);
  });
  it("maps validation paths without trusting raw server messages", () => {
    const result = classifyMutationError(
      new ApiClientError({
        code: "invalid_request",
        message: "secret",
        status: 400,
        details: [
          {
            path: ["profile", "email"],
            code: "invalid_format",
            format: "email",
            message: "secret",
          },
        ],
      }),
      { action: "save profile", form: true },
    );
    expect(result.fields).toEqual({
      "profile.email": "Enter an email address in the format name@example.com.",
    });
  });
  it.each([
    false,
    true,
  ])("handles service limits with form=%s without encouraging immediate retries", (form) => {
    const result = classifyMutationError(
      new ApiClientError({ code: "rate_limited", status: 429, message: "secret" }),
      { action: "save profile", form },
    );
    expect(result.persistent).toBe(form);
    expect(result.message).toContain("Wait a little");
  });
  it("handles malformed and non-field validation safely", () => {
    for (const details of [null, {}, [null, {}, { path: [] }]]) {
      expect(
        classifyMutationError(
          new ApiClientError({ code: "invalid_request", status: 400, message: "secret", details }),
          { action: "save profile" },
        ).fields,
      ).toEqual({});
    }
    const result = classifyMutationError(
      new ApiClientError({
        code: "invalid_request",
        status: 400,
        message: "secret",
        details: [
          { path: ["a"], code: "too_small" },
          { path: ["b"], code: "too_big" },
          { path: ["c"], code: "invalid_type" },
        ],
      }),
      { action: "save profile" },
    );
    expect(result.fields.a).toContain("longer or larger");
    expect(result.fields.b).toContain("shorter or smaller");
    expect(result.fields.c).toContain("valid value");
  });
  it.each([
    [401, "access"],
    [403, "access"],
    [409, "conflict"],
    [429, "retryable"],
  ])("classifies specialized HTTP %s errors", (status, kind) => {
    const result = classifyMutationError(
      new ApiClientError({
        code: "specialized_code",
        status: Number(status),
        message: "private diagnostic",
      }),
      { action: "connect calendar" },
    );
    expect(result.kind).toBe(kind);
    expect(result.message).not.toContain("entered values");
    expect(result.message).not.toContain("private diagnostic");
  });
  it("distinguishes rejected credentials from an expired session", () => {
    const result = classifyMutationError(
      new ApiClientError({
        code: "unauthorized",
        status: 401,
        message: "The email or password is incorrect.",
      }),
      { action: "sign in", form: true },
    );
    expect(result.message).toBe("Check your email address and password, then try again.");
    expect(result.kind).toBe("validation");
  });
  it("maps authoritative relationship rules and actual server bounds", () => {
    const error = new ApiClientError({
      code: "invalid_request",
      status: 400,
      message: "diagnostic",
      details: [
        { code: "custom", path: ["endsAt"], message: "Event end must be after its start" },
        { code: "too_small", origin: "string", minimum: 3, path: ["title"] },
        { code: "too_big", maximum: 20, path: ["count"] },
      ],
    });
    expect(classifyMutationError(error, { action: "save event" }).fields).toEqual({
      endsAt: "End time must be after start time.",
      title: "Enter at least 3 characters.",
      count: "Enter a value no greater than 20.",
    });
    expect(
      classifyMutationError(
        new ApiClientError({
          code: "invalid_request",
          status: 400,
          message: "Workday end must be after the start.",
        }),
        { action: "save profile" },
      ).fields.workdayEndMinute,
    ).toContain("after workday start");
  });
  it("offers a new link after link expiry instead of retrying an expired token", () => {
    expect(
      classifyMutationError(
        new ApiClientError({
          code: "invalid_request",
          status: 400,
          message: "This link is invalid or has expired.",
        }),
        { action: "confirm email" },
      ),
    ).toMatchObject({
      kind: "access",
      persistent: true,
      message: "This link has expired or is invalid. Request a new link and try again.",
    });
  });
  it("states inclusive and exclusive server bounds and text length limits precisely", () => {
    const error = new ApiClientError({
      code: "invalid_request",
      status: 400,
      message: "diagnostic",
      details: [
        { code: "too_small", minimum: 0, inclusive: false, path: ["positive"] },
        { code: "too_small", minimum: 1, inclusive: true, path: ["minimum"] },
        { code: "too_big", maximum: 10, inclusive: false, path: ["below"] },
        { code: "too_big", maximum: 40, origin: "string", path: ["title"] },
      ],
    });
    expect(classifyMutationError(error, { action: "save settings" }).fields).toEqual({
      positive: "Enter a value greater than 0.",
      minimum: "Enter a value of at least 1.",
      below: "Enter a value less than 10.",
      title: "Enter no more than 40 characters.",
    });
  });
  it("treats duplicate email conflicts as corrections and retains session-expired form drafts", () => {
    const duplicate = classifyMutationError(
      new ApiClientError({
        code: "conflict",
        status: 409,
        message: "That email address is already used by another account.",
      }),
      { action: "save profile", form: true },
    );
    expect(duplicate.kind).toBe("validation");
    expect(duplicate.fields.email).toBe(
      "That email address is already in use. Enter another email address.",
    );
    const expired = classifyMutationError(
      new ApiClientError({
        code: "unauthorized",
        status: 401,
        message: "The session is invalid or expired.",
      }),
      { action: "save profile", form: true },
    );
    expect(expired.message).toContain("Your entered values are still here.");
    expect(expired.persistent).toBe(true);
  });
});
