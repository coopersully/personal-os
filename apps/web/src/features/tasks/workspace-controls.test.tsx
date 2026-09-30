// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import type { TaskList, TaskProject } from "@personal-os/domain";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import {
  WorkspaceDisplay,
  WorkspaceFilterChips,
  WorkspaceFilters,
  WorkspaceSort,
} from "./workspace-controls";

const lists = [
  { id: "inbox", name: "Inbox", kind: "inbox", availability: "active" },
  { id: "work", name: "Work", kind: "standard", availability: "active" },
] as unknown as TaskList[];
const projects = [
  { id: "launch", name: "Launch", listId: "work", lifecycle: "open", availability: "active" },
] as unknown as TaskProject[];

function LocationProbe() {
  const location = useLocation();
  return <output aria-label="location">{location.pathname + location.search}</output>;
}

function mount(content: React.ReactNode, entry = "/tasks") {
  render(
    <MemoryRouter initialEntries={[entry]}>
      {content}
      <LocationProbe />
    </MemoryRouter>,
  );
}

it("changes every workspace sort and display option without closing detail selection", async () => {
  const user = userEvent.setup();
  const params = new URLSearchParams("sort=unexpected&details=none");
  mount(
    <>
      <WorkspaceSort params={params} />
      <WorkspaceDisplay params={params} />
    </>,
  );
  expect(screen.getByRole("button", { name: "Sort: Recommended" })).toBeVisible();
  await user.click(screen.getByRole("button", { name: /Sort:/ }));
  await user.click(screen.getByRole("menuitemradio", { name: "Title A–Z" }));
  expect(screen.getByLabelText("location")).toHaveTextContent("sort=title");

  await user.click(screen.getByRole("button", { name: "Display" }));
  await user.click(screen.getByRole("menuitemradio", { name: "Project" }));
  expect(screen.getByLabelText("location")).toHaveTextContent("group=project");
  await user.click(screen.getByRole("button", { name: "Display" }));
  await user.click(screen.getByRole("menuitemcheckbox", { name: "Notes" }));
  expect(screen.getByLabelText("location")).toHaveTextContent("details=none%2Cnotes");
});

it("validates advanced ranges and applies the global history controls", async () => {
  const user = userEvent.setup();
  const params = new URLSearchParams(
    "view=history&kind=task&list=work&project=launch&dueAfter=bad&dueBefore=2026-09-01T00:00:00.000Z",
  );
  mount(
    <WorkspaceFilters
      params={params}
      timeZone="America/New_York"
      lists={[...lists]}
      projects={[...projects]}
    />,
  );
  await user.click(screen.getByRole("button", { name: /Filters/ }));
  expect(screen.getByRole("option", { name: "Archived context" })).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Apply filters" }));
  expect(screen.getByRole("alert")).toHaveTextContent("valid date");

  await user.click(screen.getByRole("button", { name: "Advanced" }));
  await user.clear(screen.getByLabelText("Deadline after"));
  await user.type(screen.getByLabelText("Deadline after"), "2026-09-03T12:00");
  await user.clear(screen.getByLabelText("Deadline before"));
  await user.type(screen.getByLabelText("Deadline before"), "2026-09-02T12:00");
  await user.click(screen.getByRole("button", { name: "Apply filters" }));
  expect(screen.getByRole("alert")).toHaveTextContent("must be before");

  await user.selectOptions(screen.getByLabelText("Type"), "reminder");
  expect(screen.getByLabelText("Reserved time")).toBeDisabled();
  expect(screen.getByLabelText("Tag")).toBeDisabled();
  await user.selectOptions(screen.getByLabelText("Type"), "task");
  await user.selectOptions(screen.getByLabelText("Deadline"), "tomorrow");
  await user.selectOptions(screen.getByLabelText("Reserved time"), "none");
  await user.selectOptions(screen.getByLabelText("Priority"), "low");
  await user.selectOptions(screen.getByLabelText("List"), "work");
  await user.selectOptions(screen.getByLabelText("Project"), "launch");
  await user.click(screen.getByRole("button", { name: "Apply filters" }));
  expect(screen.getByLabelText("location")).toHaveTextContent("priority=low");
});

it("summarizes and removes special, custom, invalid, and container filters", async () => {
  const user = userEvent.setup();
  const params = new URLSearchParams(
    "view=all&kind=reminder&status=cancelled&due=overdue&reserved=scheduled&priority=high&tag=errands&dueAfter=bad&dueBefore=2026-09-05T12:00:00.000Z&scheduledAfter=2026-09-07T12:00:00.000Z&list=missing&project=launch",
  );
  mount(
    <WorkspaceFilterChips
      params={params}
      timeZone="America/New_York"
      lists={[...lists]}
      projects={[...projects]}
    />,
  );
  expect(screen.getByRole("group", { name: "Active task filters" })).toBeVisible();
  expect(
    screen.getByRole("button", { name: /Remove Deadline: from invalid date until/ }),
  ).toBeVisible();
  expect(screen.getByRole("button", { name: "Remove list" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Remove Launch" })).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Remove list" }));
  expect(screen.getByLabelText("location")).not.toHaveTextContent("list=");
  expect(screen.getByLabelText("location")).not.toHaveTextContent("project=");
});

it("clears optional controls and covers custom date and display reversals", async () => {
  const user = userEvent.setup();
  mount(<WorkspaceDisplay params={new URLSearchParams("details=notes")} />);
  await user.click(screen.getByRole("button", { name: "Display" }));
  await user.click(screen.getByRole("menuitemcheckbox", { name: "Notes" }));
  expect(screen.getByLabelText("location")).toHaveTextContent("details=none");

  cleanup();
  const params = new URLSearchParams(
    "view=all&kind=task&priority=high&reserved=scheduled&list=work&project=launch",
  );
  mount(
    <WorkspaceFilters
      params={params}
      timeZone="America/New_York"
      lists={[...lists]}
      projects={[...projects]}
    />,
  );
  await user.click(screen.getByRole("button", { name: /Filters/ }));
  await user.selectOptions(screen.getByLabelText("Deadline"), "custom");
  await user.clear(screen.getByLabelText("Deadline after"));
  await user.type(screen.getByLabelText("Deadline after"), "2026-09-07T09:00");
  await user.clear(screen.getByLabelText("Reserved after"));
  await user.type(screen.getByLabelText("Reserved after"), "2026-09-07T10:00");
  await user.selectOptions(screen.getByLabelText("Reserved time"), "any");
  await user.selectOptions(screen.getByLabelText("Priority"), "any");
  await user.selectOptions(screen.getByLabelText("List"), "any");
  await user.selectOptions(screen.getByLabelText("Project"), "any");
  await user.click(screen.getByRole("button", { name: "Clear" }));
  expect(screen.getByLabelText("location")).toHaveTextContent("/tasks?view=all");
});

it("summarizes one-sided, preset, and absent ranges", () => {
  const params = new URLSearchParams(
    "view=all&dueAfter=2026-09-07T04:00:00.000Z&dueBefore=2026-09-08T03:59:59.999Z&scheduledAfter=2026-09-07T12:00:00.000Z",
  );
  mount(
    <WorkspaceFilterChips
      params={params}
      timeZone="America/New_York"
      lists={[...lists]}
      projects={[...projects]}
    />,
  );
  expect(screen.getByRole("button", { name: /Remove Deadline:/ })).toBeVisible();
  expect(screen.getByRole("button", { name: /Remove Reserved: from/ })).toBeVisible();
  cleanup();
  mount(
    <WorkspaceFilterChips
      params={new URLSearchParams()}
      timeZone="America/New_York"
      lists={[]}
      projects={[]}
    />,
  );
  expect(screen.queryByRole("group", { name: "Active task filters" })).not.toBeInTheDocument();
});
