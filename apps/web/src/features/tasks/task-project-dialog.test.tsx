// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import type { TaskList, TaskProject } from "@personal-os/domain";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { TaskProjectDialog } from "./task-project-dialog";

const api = vi.hoisted(() => ({ updateTaskProject: vi.fn() }));
vi.mock("../../api.js", () => ({ api, errorMessage: (error: Error) => error.message }));

it("keeps project management in the body and submits from the separate action footer", async () => {
  const user = userEvent.setup();
  const close = vi.fn();
  const project = {
    id: "project",
    listId: "personal",
    name: "Apartment reset",
    lifecycle: "completed",
    notes: null,
    why: null,
    targetDate: null,
    revision: 3,
  } as TaskProject;
  const list = { id: "personal", name: "Personal" } as TaskList;
  api.updateTaskProject.mockResolvedValue(project);
  render(
    <QueryClientProvider client={new QueryClient()}>
      <TaskProjectDialog
        close={close}
        listId={list.id}
        lists={[list]}
        project={project}
        projects={[project]}
      />
    </QueryClientProvider>,
  );
  const save = screen.getByRole("button", { name: "Save changes" }) as HTMLButtonElement;
  const footer = save.closest('[data-responsive-slot="footer"]');
  const body = screen.getByLabelText("Move to List").closest('[data-responsive-slot="body"]');
  expect(footer).not.toBeNull();
  expect(body).not.toContainElement(save);
  expect(body).toContainElement(screen.getByRole("button", { name: "Archive Project" }));
  expect(save.form).toContainElement(screen.getByLabelText("Name"));
  await user.clear(screen.getByLabelText("Name"));
  await user.type(screen.getByLabelText("Name"), "Home reset");
  await user.click(save);
  await waitFor(() =>
    expect(api.updateTaskProject).toHaveBeenCalledWith(
      "project",
      expect.objectContaining({ name: "Home reset", expectedRevision: 3 }),
    ),
  );
  await waitFor(() => expect(close).toHaveBeenCalledOnce());
});
