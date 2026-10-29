import type { Database } from "@personal-os/database";
import { oauthScopeSubset, readOAuthActorLineage } from "./oauth-actor-lineage.js";

const identity = {
  id: "old",
  userId: "owner",
  clientId: "client",
  audience: "resource",
  authorizationConnectionId: "connection",
  scopes: ["finances:read"] as const,
};
it("accepts only scope narrowing, never scope escalation", () => {
  expect(oauthScopeSubset(["read"], ["read", "write"])).toBe(true);
  expect(oauthScopeSubset(["write"], ["read"])).toBe(false);
});
function dbFor(
  edges: Record<string, unknown> = {},
  endpoints: unknown[] = [identity, { ...identity, id: "new" }],
) {
  const where = vi.fn();
  return {
    select: () => ({
      from: () => ({
        where: (condition: unknown) => {
          where(condition);
          return {
            orderBy: async () => endpoints,
            limit: async () => Object.values(edges).slice(0, 1),
          };
        },
      }),
    }),
  } as unknown as Database;
}
it("does not mistake the same connection for a proven rotation", async () => {
  expect(
    await readOAuthActorLineage(dbFor(), {
      ownerId: "owner",
      ancestorActorId: "old",
      currentActorId: "new",
      audience: "resource",
    }),
  ).toBeNull();
});
it("returns only IDs for a proven historical path and allows an identical actor", async () => {
  const input = {
    ownerId: "owner",
    ancestorActorId: "old",
    currentActorId: "new",
    audience: "resource",
  };
  expect(
    await readOAuthActorLineage(
      dbFor({
        edge: {
          from: "old",
          clientId: "client",
          connectionId: "connection",
          predecessorScopes: ["finances:read"],
          successorScopes: ["finances:read"],
        },
      }),
      input,
    ),
  ).toEqual({ actorIds: ["old", "new"] });
  expect(await readOAuthActorLineage(dbFor(), { ...input, currentActorId: "old" })).toEqual({
    actorIds: ["old"],
  });
});
it("rejects cycles and mismatched dimensions in persisted evidence", async () => {
  const input = {
    ownerId: "owner",
    ancestorActorId: "old",
    currentActorId: "new",
    audience: "resource",
  };
  for (const edge of [
    { from: "new", clientId: "client" },
    { from: "old", clientId: "foreign" },
  ])
    expect(
      await readOAuthActorLineage(
        dbFor({
          edge: { ...edge, connectionId: "connection", predecessorScopes: [], successorScopes: [] },
        }),
        input,
      ),
    ).toBeNull();
});
it("bounds historical traversal to64 edges without scanning all token history", async () => {
  let reads = 0;
  const db = {
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: async () => [identity, { ...identity, id: "new" }],
          limit: async () => [
            {
              from: `hop-${reads++}`,
              clientId: "client",
              connectionId: "connection",
              predecessorScopes: [],
              successorScopes: [],
            },
          ],
        }),
      }),
    }),
  } as unknown as Database;
  expect(
    await readOAuthActorLineage(db, {
      ownerId: "owner",
      ancestorActorId: "old",
      currentActorId: "new",
      audience: "resource",
    }),
  ).toBeNull();
  expect(reads).toBe(64);
});
it("does not return another owner's or missing endpoint identity", async () => {
  expect(
    await readOAuthActorLineage(dbFor({}, []), {
      ownerId: "foreign",
      ancestorActorId: "old",
      currentActorId: "new",
      audience: "resource",
    }),
  ).toBeNull();
});
