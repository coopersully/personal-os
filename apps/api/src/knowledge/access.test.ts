import type { Principal } from "../types.js";
import { createKnowledgeAccess, type KnowledgeTransaction } from "./access.js";

const at = new Date("2026-11-15T12:00:00Z");
const agent: Principal = {
  userId: "00000000-0000-4000-8000-000000000001",
  actorId: "00000000-0000-4000-8000-000000000002",
  actorType: "agent",
  scopes: new Set(["knowledge:read", "finances:read"]),
};

/** A transaction whose token reads return the current `token` and are counted. */
function transaction(token: () => Record<string, unknown> | undefined) {
  const reads = { count: 0 };
  const tx = {
    select: () => ({
      from: () => ({
        where: () => ({
          for: async () => {
            reads.count += 1;
            const row = token();
            return row ? [row] : [];
          },
        }),
      }),
    }),
  } as unknown as KnowledgeTransaction;
  return { tx, reads };
}

describe("knowledge credential authorization", () => {
  it("reads the live token once per transaction and checks scopes on every call", async () => {
    const access = createKnowledgeAccess(() => at);
    const scopes = ["knowledge:read", "finances:read"];
    const { tx, reads } = transaction(() => ({
      scopes,
      revokedAt: null,
      expiresAt: null,
      authorizationConnectionId: null,
    }));
    for (let i = 0; i < 5; i++) await access.authorize(tx, agent, ["knowledge:read"]);
    await access.authorize(tx, agent, ["finances:read"]);
    expect(reads.count).toBe(1);
    // A scope the token never held is still refused from the shared row.
    await expect(access.authorize(tx, agent, ["mail:read"])).rejects.toMatchObject({
      status: 403,
    });
    expect(reads.count).toBe(1);
  });

  it("reads narrowing and revocation afresh in the next transaction", async () => {
    // One long-lived access instance, as services hold, spanning two requests.
    const access = createKnowledgeAccess(() => at);
    let row: Record<string, unknown> = {
      scopes: ["knowledge:read", "finances:read"],
      revokedAt: null,
      expiresAt: null,
      authorizationConnectionId: null,
    };
    const first = transaction(() => row);
    await access.authorize(first.tx, agent, ["finances:read"]);
    row = { ...row, scopes: ["knowledge:read"] };
    const second = transaction(() => row);
    await expect(access.authorize(second.tx, agent, ["finances:read"])).rejects.toMatchObject({
      status: 403,
    });
    row = { ...row, revokedAt: at };
    const third = transaction(() => row);
    await expect(access.authorize(third.tx, agent, ["knowledge:read"])).rejects.toMatchObject({
      status: 403,
    });
    expect([first.reads.count, second.reads.count, third.reads.count]).toEqual([1, 1, 1]);
  });

  it("still checks expiry against the clock on every call", async () => {
    let clock = at;
    const access = createKnowledgeAccess(() => clock);
    const { tx } = transaction(() => ({
      scopes: ["knowledge:read"],
      revokedAt: null,
      expiresAt: new Date(at.getTime() + 1000),
      authorizationConnectionId: null,
    }));
    await access.authorize(tx, agent, ["knowledge:read"]);
    clock = new Date(at.getTime() + 2000);
    await expect(access.authorize(tx, agent, ["knowledge:read"])).rejects.toMatchObject({
      status: 403,
    });
  });
});
