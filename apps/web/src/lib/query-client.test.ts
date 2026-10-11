import { ApiClientError } from "@personal-os/api-client";
import { describe, expect, it } from "vitest";
import { createAppQueryClient } from "./query-client.js";

const denial = (status: number) =>
  new ApiClientError({
    status,
    code: status === 401 ? "unauthorized" : "forbidden",
    message: "Access denied",
  });

describe("query access recovery", () => {
  it.each([
    new Error("Offline"),
    new ApiClientError({ status: 500, code: "internal_error", message: "Server failed" }),
  ])("retains stale material for retryable failures", async (error) => {
    const client = createAppQueryClient();
    client.setQueryData(["finances"], { balance: 123 });
    await expect(
      client.fetchQuery({
        queryKey: ["finances"],
        queryFn: () => Promise.reject(error),
        retry: false,
      }),
    ).rejects.toBe(error);
    expect(client.getQueryData(["finances"])).toEqual({ balance: 123 });
    client.clear();
  });

  it("removes forbidden data while preserving unrelated authorized data", async () => {
    const client = createAppQueryClient({ queries: { retry: false } });
    client.setQueryData(["finances"], { balance: 123 });
    client.setQueryData(["me"], { id: "person" });
    const error = denial(403);
    await expect(
      client.fetchQuery({ queryKey: ["finances"], queryFn: () => Promise.reject(error) }),
    ).rejects.toBe(error);
    expect(client.getQueryState(["finances"])).toMatchObject({
      status: "error",
      data: undefined,
      error,
    });
    expect(client.getQueryData(["me"])).toEqual({ id: "person" });
    client.clear();
  });

  it("preserves native updater status when the server session expires", async () => {
    const client = createAppQueryClient({ queries: { retry: false } });
    const status = { startupBlocking: false, phase: "unavailable" };
    await client.fetchQuery({
      queryKey: ["desktop-update-status"],
      meta: { sessionIndependent: true },
      queryFn: async () => status,
    });
    await expect(
      client.fetchQuery({ queryKey: ["me"], queryFn: () => Promise.reject(denial(401)) }),
    ).rejects.toMatchObject({ status: 401 });
    expect(client.getQueryState(["desktop-update-status"])).toMatchObject({
      status: "success",
      data: status,
      error: null,
    });
    client.clear();
  });

  it("expires all cached session data and cancels late responses after a 401", async () => {
    const client = createAppQueryClient({ queries: { retry: false } });
    client.setQueryData(["me"], { id: "previous-person" });
    client.setQueryData(["finances"], { balance: 123 });
    let finish: ((value: string) => void) | undefined;
    let aborted = false;
    const pending = client
      .fetchQuery({
        queryKey: ["mail"],
        queryFn: ({ signal }) => {
          signal.addEventListener("abort", () => {
            aborted = true;
          });
          return new Promise<string>((resolve) => {
            finish = resolve;
          });
        },
      })
      .catch(() => undefined);
    const error = denial(401);
    await expect(
      client.fetchQuery({ queryKey: ["finances"], queryFn: () => Promise.reject(error) }),
    ).rejects.toBe(error);
    expect(aborted).toBe(true);
    finish?.("previous person's mail");
    await pending;
    for (const key of ["me", "finances", "mail"]) {
      expect(client.getQueryState([key])).toMatchObject({
        status: "error",
        data: undefined,
        error,
      });
    }
    client.clear();
  });
  it("expires cached identity and cancels reads when a mutation loses its session", async () => {
    const client = createAppQueryClient({ queries: { retry: false } });
    client.setQueryData(["me"], { id: "previous-person" });
    client.setQueryData(["finances"], { balance: 123 });
    let finish: ((value: string) => void) | undefined;
    let aborted = false;
    const pending = client
      .fetchQuery({
        queryKey: ["mail"],
        queryFn: ({ signal }) => {
          signal.addEventListener("abort", () => {
            aborted = true;
          });
          return new Promise<string>((resolve) => {
            finish = resolve;
          });
        },
      })
      .catch(() => undefined);
    const error = denial(401);
    const mutation = client
      .getMutationCache()
      .build(client, { mutationFn: () => Promise.reject(error) });
    await expect(mutation.execute(undefined)).rejects.toBe(error);
    expect(aborted).toBe(true);
    finish?.("previous person's mail");
    await pending;
    for (const key of ["me", "finances", "mail"]) {
      expect(client.getQueryState([key])).toMatchObject({
        status: "error",
        data: undefined,
        error,
      });
    }
    client.clear();
  });

  it.each([
    "original",
    "another",
  ])("ignores an old mutation's 401 after signing in as %s", async (nextIdentity) => {
    const client = createAppQueryClient();
    client.setQueryData(["me"], { id: "original" });
    let rejectRequest: (error: Error) => void = () => undefined;
    let started: () => void = () => undefined;
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    const mutation = client.getMutationCache().build(client, {
      mutationFn: () =>
        new Promise<void>((_resolve, reject) => {
          rejectRequest = reject;
          started();
        }),
    });
    const pending = mutation.execute(undefined);
    const rejected = expect(pending).rejects.toMatchObject({ status: 401 });
    await ready;
    client.removeQueries({ queryKey: ["me"], exact: true });
    client.setQueryData(["me"], { id: nextIdentity });
    client.setQueryData(["mail"], ["new session's mail"]);
    rejectRequest(denial(401));
    await rejected;
    expect(client.getQueryData(["me"])).toEqual({ id: nextIdentity });
    expect(client.getQueryData(["mail"])).toEqual(["new session's mail"]);
    client.clear();
  });

  it("still expires the current session after a profile update", async () => {
    const client = createAppQueryClient();
    client.setQueryData(["me"], { id: "person", name: "Before" });
    const error = denial(401);
    const mutation = client.getMutationCache().build(client, {
      mutationFn: async () => {
        client.setQueryData(["me"], { id: "person", name: "After" });
        throw error;
      },
    });
    await expect(mutation.execute(undefined)).rejects.toBe(error);
    expect(client.getQueryData(["me"])).toBeUndefined();
    client.clear();
  });

  it("does not revoke read access when a mutation alone is forbidden", async () => {
    const client = createAppQueryClient();
    client.setQueryData(["me"], { id: "person" });
    const error = denial(403);
    const mutation = client
      .getMutationCache()
      .build(client, { mutationFn: () => Promise.reject(error) });
    await expect(mutation.execute(undefined)).rejects.toBe(error);
    expect(client.getQueryData(["me"])).toEqual({ id: "person" });
    client.clear();
  });
});
