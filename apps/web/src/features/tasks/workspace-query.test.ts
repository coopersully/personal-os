import {
  canonicalWorkspaceParams,
  withWorkspaceOption,
  workspacePath,
  workspaceQuery,
} from "./workspace-query";

describe("Tasks workspace URLs", () => {
  it.each([
    ["view=scheduled&q=rent", "view=all&q=rent&reserved=scheduled&sort=reserved"],
    ["view=scheduled&sort=priority", "view=all&sort=priority&reserved=scheduled"],
    ["view=completed", "view=history&status=completed"],
    ["view=cancelled", "view=history&status=cancelled"],
    ["view=today&lifecycle=open", "view=today&status=open"],
  ])("keeps the meaning of legacy links %s", (input, expected) => {
    expect(canonicalWorkspaceParams(new URLSearchParams(input)).toString()).toBe(expected);
  });
  it("keeps reminder links in the shared workspace without converting the record", () => {
    expect(
      canonicalWorkspaceParams(
        new URLSearchParams("view=completed&q=call&reminder=r1"),
        true,
      ).toString(),
    ).toBe("view=history&q=call&reminder=r1&status=completed&kind=reminder");
    expect(canonicalWorkspaceParams(new URLSearchParams(), true).toString()).toBe(
      "view=all&kind=reminder",
    );
  });
  it("uses the protected Inbox only when no global destination is selected", () => {
    expect(workspaceQuery(new URLSearchParams(), "inbox-id")).toMatchObject({
      view: "all",
      kind: "task",
      listId: "inbox-id",
    });
    expect(
      workspaceQuery(new URLSearchParams("view=all&kind=reminder"), "inbox-id"),
    ).not.toHaveProperty("listId");
  });
  it("passes supported filters and sorting to the server, not presentation flags", () => {
    expect(
      workspaceQuery(
        new URLSearchParams(
          "view=all&kind=task&priority=high&due=none&reserved=none&sort=estimate&group=list&details=tags&tag=work",
        ),
        "inbox-id",
      ),
    ).toEqual({
      view: "all",
      kind: "task",
      priority: "high",
      due: "none",
      reserved: "none",
      sort: "estimate",
      group: "list",
      tag: "work",
    });
  });
  it("changes workspace options without retaining an inspected record", () => {
    expect(
      withWorkspaceOption(
        new URLSearchParams("task=t1&reminder=r1&sort=created"),
        "sort",
        "priority",
      ),
    ).toBe("/tasks?sort=priority");
    expect(
      withWorkspaceOption(new URLSearchParams("sort=priority"), "sort", "created", "created"),
    ).toBe("/tasks");
    expect(workspacePath(new URLSearchParams())).toBe("/tasks");
  });
});
