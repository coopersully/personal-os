import { createMcpWorkspaceFixture, type WorkspaceFixture } from "./fixture.js";

describe("Tasks and Reminders through MCP", () => {
  let f: WorkspaceFixture;
  beforeAll(async () => {
    f = await createMcpWorkspaceFixture();
  }, 120_000);
  afterAll(async () => {
    await f?.close();
  });
  it.each([
    false,
    true,
  ])("preserves direct scoped task lifecycles with bypass=%s", async (bypass) => {
    await f.setBypass(bypass);
    const { client } = await f.connectAgent([
      "tasks:read",
      "tasks:write",
      "reminders:read",
      "reminders:write",
    ]);
    async function call(name: string, args: Record<string, unknown> = {}) {
      const r = await client.callTool({ name, arguments: args });
      expect(r.isError, JSON.stringify(r)).not.toBe(true);
      return (r.structuredContent as { result: Record<string, unknown> }).result;
    }
    const list = await call("create_task_list", {
      name: `Agent work ${bypass}`,
      idempotencyKey: crypto.randomUUID(),
    });
    const project = await call("create_task_project", {
      name: "Parity",
      listId: list.id,
      idempotencyKey: crypto.randomUUID(),
    });
    let task = await call("create_task", {
      title: "Agent fixture task",
      listId: list.id,
      projectId: project.id,
      idempotencyKey: crypto.randomUUID(),
    });
    task = await call("update_task", {
      id: task.id,
      expectedRevision: task.revision,
      title: "Edited task",
    });
    for (const name of [
      "complete_task",
      "reopen_task",
      "cancel_task",
      "reopen_task",
      "trash_task",
      "restore_task",
    ])
      task = await call(name, { id: task.id, expectedRevision: task.revision });
    expect(await call("get_task", { id: task.id })).toMatchObject({
      title: "Edited task",
      lifecycle: "open",
      deletedAt: null,
    });
    const second = await call("create_task_list", {
      name: `Destination ${bypass}`,
      idempotencyKey: crypto.randomUUID(),
    });
    const preview = await call("preview_task_move", {
      id: task.id,
      expectedRevision: task.revision,
      destinationListId: second.id,
    });
    task = await call("move_task", {
      id: task.id,
      expectedRevision: task.revision,
      destinationListId: second.id,
      previewToken: preview.previewToken,
    });
    expect(task).toMatchObject({ listId: second.id, projectId: null });
    let reminder = await call("create_reminder", {
      title: "Reminder fixture",
      dueAt: "2026-10-11T14:00:00Z",
      timezone: "America/New_York",
    });
    expect(await call("get_reminder", { id: reminder.id })).toMatchObject({
      title: "Reminder fixture",
    });

    const reminderId = reminder.id;
    f.advanceTime(1000);
    reminder = await call("update_reminder", {
      id: reminderId,
      expectedUpdatedAt: reminder.updatedAt,
      notes: "Verified persistence",
      priority: "high",
    });
    for (const completed of [true, false]) {
      f.advanceTime(1000);
      reminder = await call("complete_reminder", {
        id: reminderId,
        expectedUpdatedAt: reminder.updatedAt,
        completed,
      });
    }
    f.advanceTime(1000);
    reminder = await call("delete_reminder", {
      id: reminderId,
      expectedUpdatedAt: reminder.updatedAt,
    });
    f.advanceTime(1000);
    reminder = await call("restore_reminder", {
      id: reminderId,
      expectedUpdatedAt: reminder.updatedAt,
    });
    expect(reminder).toMatchObject({
      notes: "Verified persistence",
      priority: "high",
      completedAt: null,
    });
    let currentProject = await call("get_task_project", { id: project.id });
    currentProject = await call("update_task_project", {
      id: project.id,
      expectedRevision: currentProject.revision,
      name: "Reviewed parity",
    });
    const projectPreview = await call("preview_task_project_move", {
      id: project.id,
      expectedRevision: currentProject.revision,
      destinationListId: second.id,
    });
    currentProject = await call("move_task_project", {
      id: project.id,
      expectedRevision: currentProject.revision,
      destinationListId: second.id,
      previewToken: projectPreview.previewToken,
    });
    currentProject = await call("complete_task_project", {
      id: project.id,
      expectedRevision: currentProject.revision,
    });
    expect(currentProject).toMatchObject({ lifecycle: "completed", listId: second.id });
    currentProject = await call("archive_task_project", {
      id: project.id,
      expectedRevision: currentProject.revision,
    });
    let oldList = await call("get_task_list", { id: list.id });
    oldList = await call("update_task_list", {
      id: list.id,
      expectedRevision: oldList.revision,
      name: `Empty source ${bypass}`,
    });
    await call("archive_task_list", { id: list.id, expectedRevision: oldList.revision });

    const cancelledProject = await call("create_task_project", {
      name: "Cancelled fixture",
      listId: second.id,
      idempotencyKey: crypto.randomUUID(),
    });
    expect(
      await call("cancel_task_project", {
        id: cancelledProject.id,
        expectedRevision: cancelledProject.revision,
      }),
    ).toMatchObject({ lifecycle: "cancelled" });
    await call("preview_overdue_reminder_deferral", {
      overdueBefore: "2026-10-11T15:00:00Z",
      proposedDueAt: "2026-10-13T12:00:00Z",
      timezone: "America/New_York",
    });
    const attention = await call("create_reminder_attention_item", {
      reminderId,
      title: "Follow up",
      summary: "Fixture obligation",
      kind: "follow_up",
    });
    expect(attention).toMatchObject({ title: "Follow up" });
    const mixed = await call("list_task_workspace", {});
    expect(JSON.stringify(mixed)).toContain("Edited task");
    expect(JSON.stringify(mixed)).toContain("Reminder fixture");
    const alien = await f.connectAgent(["tasks:read"], { ownerId: f.otherOwner.id });
    expect(
      (await alien.client.callTool({ name: "get_task", arguments: { id: task.id } })).isError,
    ).toBe(true);
  });
});
