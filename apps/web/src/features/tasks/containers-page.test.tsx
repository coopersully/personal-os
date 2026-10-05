// @vitest-environment jsdom
import type { TaskList, TaskProject } from "@personal-os/domain";
import { describe, expect, it } from "vitest";
import { selectTaskContainers } from "./containers-page";
import { taskPath } from "./task-navigation";

const lists = [
  {
    id: "work",
    name: "Work",
    description: "Career",
    availability: "active",
    updatedAt: "2026-10-01",
    createdAt: "2026-01-01",
  },
  {
    id: "home",
    name: "Home",
    description: "Household",
    availability: "active",
    updatedAt: "2026-10-03",
    createdAt: "2026-02-01",
  },
  {
    id: "archive",
    name: "Past",
    availability: "archived",
    updatedAt: "2026-10-02",
    createdAt: "2026-03-01",
  },
] as TaskList[];
const projects = [
  {
    id: "launch",
    name: "Launch",
    listId: "work",
    notes: "Invite partners",
    lifecycle: "open",
    availability: "active",
    targetDate: "2026-11-01",
    updatedAt: "2026-10-03",
    createdAt: "2026-01-01",
  },
  {
    id: "garden",
    name: "Garden",
    listId: "home",
    lifecycle: "open",
    availability: "active",
    targetDate: null,
    updatedAt: "2026-10-01",
    createdAt: "2026-02-01",
  },
  {
    id: "done",
    name: "Delivered",
    listId: "work",
    lifecycle: "completed",
    availability: "active",
    updatedAt: "2026-10-02",
    createdAt: "2026-03-01",
  },
  {
    id: "past",
    name: "Past work",
    listId: "archive",
    lifecycle: "open",
    availability: "active",
    updatedAt: "2026-10-02",
    createdAt: "2026-03-01",
  },
] as TaskProject[];
const ids = (kind: "lists" | "projects" | "archive", search = "") =>
  selectTaskContainers(kind, lists, projects, new URLSearchParams(search)).map(
    (record) => record.id,
  );

describe("task container collections", () => {
  it("shows retained containers in Archive with shared search, status, and sort", () => {
    expect(ids("archive")).toEqual(["done", "archive", "past"]);
    expect(ids("archive", "q=delivered")).toEqual(["done"]);
    expect(ids("archive", "containerStatus=archived")).toEqual(["archive", "past"]);
    expect(ids("archive", "containerStatus=completed")).toEqual(["done"]);
  });
  it("shows active lists and open projects with active owners by default", () => {
    expect(ids("lists")).toEqual(["home", "work"]);
    expect(ids("projects")).toEqual(["launch", "garden"]);
    expect(ids("projects", "containerStatus=archived")).toEqual(["past"]);
    expect(ids("projects", "containerStatus=completed")).toEqual(["done"]);
  });
  it("searches descriptions, notes, and owning list names", () => {
    expect(ids("lists", "q=household")).toEqual(["home"]);
    expect(ids("projects", "q=partners")).toEqual(["launch"]);
    expect(ids("projects", "q=work")).toEqual(["launch"]);
  });
  it("sorts recent updates and puts undated projects last", () => {
    expect(ids("projects", "containerSort=updated")).toEqual(["launch", "garden"]);
    expect(ids("projects", "containerSort=target")).toEqual(["launch", "garden"]);
  });
  it("does not carry incompatible task filters into collection views or back", () => {
    expect(
      taskPath(new URLSearchParams("priority=high&sort=priority&q=launch"), { view: "projects" }),
    ).toBe("/tasks?q=launch&view=projects");
    expect(
      taskPath(new URLSearchParams("view=projects&containerStatus=archived&containerSort=target"), {
        view: "all",
      }),
    ).toBe("/tasks?view=all");
  });
});
