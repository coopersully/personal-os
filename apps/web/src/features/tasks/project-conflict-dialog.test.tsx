// @vitest-environment jsdom

import type { TaskList, TaskProject, TaskProjectCompletionConflict } from "@personal-os/domain";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { ProjectConflictDialog } from "./project-conflict-dialog.js";

const now = "2026-08-24T12:00:00.000Z";
const destinationList: TaskList = {
  archivedAt: null,
  availability: "active",
  color: null,
  createdAt: now,
  deletedAt: null,
  description: null,
  id: "11111111-1111-4111-8111-111111111111",
  kind: "standard",
  name: "Home",
  revision: 2,
  source: {
    accountId: null,
    provider: "local",
    remoteId: "11111111-1111-4111-8111-111111111111",
    revision: "2",
    sourceType: "task_list",
  },
  updatedAt: now,
};
const destinationProject: TaskProject = {
  archivedAt: null,
  availability: "active",
  cancelledAt: null,
  completedAt: null,
  createdAt: now,
  deletedAt: null,
  id: "22222222-2222-4222-8222-222222222222",
  lifecycle: "open",
  listId: destinationList.id,
  name: "Kitchen refresh",
  notes: null,
  revision: 3,
  source: {
    accountId: null,
    provider: "local",
    remoteId: "22222222-2222-4222-8222-222222222222",
    revision: "3",
    sourceType: "task_project",
  },
  targetDate: null,
  updatedAt: now,
  why: null,
};
const conflict: TaskProjectCompletionConflict = {
  code: "task_project_has_open_tasks",
  currentRevisions: {
    destinationList: null,
    project: 4,
    sourceList: 2,
    task: null,
  },
  openContentCounts: { projects: 0, tasks: 3 },
  resolutions: ["complete_open_tasks", "cancel_open_tasks", "move_open_tasks", "keep_project_open"],
};

it("offers every server-authored Project completion outcome and forwards the chosen destination", async () => {
  const browser = userEvent.setup();
  const onResolve = vi.fn();
  render(
    <ProjectConflictDialog
      close={vi.fn()}
      conflict={conflict}
      lists={[destinationList]}
      onResolve={onResolve}
      pending={false}
      projects={[destinationProject]}
    />,
  );

  await browser.click(screen.getByRole("button", { name: "Complete open Tasks" }));
  await browser.click(screen.getByRole("button", { name: "Cancel open Tasks" }));
  await browser.click(screen.getByRole("button", { name: "Keep Project open" }));
  await browser.selectOptions(screen.getByLabelText("Destination List"), destinationList.id);
  await browser.selectOptions(screen.getByLabelText("Destination Project"), destinationProject.id);
  await browser.click(screen.getByRole("button", { name: "Move open Tasks" }));

  expect(onResolve.mock.calls).toEqual([
    ["complete_open_tasks"],
    ["cancel_open_tasks"],
    ["keep_project_open"],
    ["move_open_tasks", destinationList.id, destinationProject.id],
  ]);
});
