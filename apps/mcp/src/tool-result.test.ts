import { ApiClientError } from "@personal-os/api-client";
import { describe, expect, it } from "vitest";
import { apiResult, emptyResult, result } from "./tool-result.js";

describe("MCP tool result envelopes", () => {
  it("formats structured and empty successful results", () => {
    expect(result({ id: "result-1" })).toEqual({
      content: [{ text: '{\n  "id": "result-1"\n}', type: "text" }],
      structuredContent: { result: { id: "result-1" } },
    });
    expect(emptyResult("Nothing changed.")).toEqual({
      content: [{ text: "Nothing changed.", type: "text" }],
      structuredContent: { ok: true },
    });
  });

  it("preserves successful API results", async () => {
    await expect(apiResult(async () => ({ id: "result-1" }))).resolves.toEqual(
      result({ id: "result-1" }),
    );
  });

  it("returns the authenticated API failure contract", async () => {
    const error = new ApiClientError({
      code: "conflict",
      details: { field: "title" },
      message: "The title changed.",
      requestId: "request-1",
      status: 409,
    });

    await expect(apiResult(async () => Promise.reject(error))).resolves.toEqual({
      content: [
        {
          text: JSON.stringify(
            {
              error: {
                code: "conflict",
                details: { field: "title" },
                message: "The title changed.",
                requestId: "request-1",
                status: 409,
              },
            },
            null,
            2,
          ),
          type: "text",
        },
      ],
      isError: true,
      structuredContent: {
        error: {
          code: "conflict",
          details: { field: "title" },
          message: "The title changed.",
          requestId: "request-1",
          status: 409,
        },
      },
    });
  });

  it("does not disguise unexpected errors as API failures", async () => {
    const error = new Error("unexpected");
    await expect(apiResult(async () => Promise.reject(error))).rejects.toBe(error);
  });
});
