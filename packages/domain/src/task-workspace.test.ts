import { taskWorkspaceQuerySchema } from "./task-workspace.js";

describe("task workspace query", () => {
  it("accepts reserved-time sorting independently of deadline sorting", () => {
    expect(taskWorkspaceQuerySchema.parse({ sort: "reserved" }).sort).toBe("reserved");
  });
  it("provides bounded read defaults without imposing a lifecycle on History", () => {
    expect(taskWorkspaceQuerySchema.parse({})).toMatchObject({
      due: "any",
      group: "none",
      kind: "all",
      limit: 50,
      reserved: "any",
      sort: "default",
      view: "all",
    });
    expect(taskWorkspaceQuerySchema.parse({ view: "history" }).status).toBeUndefined();
  });

  it.each([
    { limit: 101 },
    { cursor: "" },
    { cursor: "x".repeat(4097) },
    { view: "inbox" },
    { kind: "event" },
    { query: " " },
    { tag: " " },
    { listId: "inbox" },
    { due: "tomorrow" },
    { reserved: "true" },
    { sort: "random" },
    { group: "kind" },
    { status: "next" },
    { dueAfter: "2026-09-03" },
    { dueAfter: "2026-09-04T00:00:00Z", dueBefore: "2026-09-03T00:00:00Z" },
    { scheduledAfter: "2026-09-04T00:00:00Z", scheduledBefore: "2026-09-03T00:00:00Z" },
  ])("rejects invalid query %j", (input) => {
    expect(taskWorkspaceQuerySchema.safeParse(input).success).toBe(false);
  });

  it("compares offset bounds as exact instants and trims search terms", () => {
    expect(
      taskWorkspaceQuerySchema.parse({
        dueAfter: "2026-09-03T01:00:00+02:00",
        dueBefore: "2026-09-03T00:00:00Z",
        query: "  plan  ",
        tag: " work ",
        limit: "7",
      }),
    ).toMatchObject({ query: "plan", tag: "work", limit: 7 });
  });
});
