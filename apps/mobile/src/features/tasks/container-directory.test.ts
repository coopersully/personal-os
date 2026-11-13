import type { TaskList, TaskProject } from "@personal-os/domain";
import { describe, expect, it } from "vitest";
import { containerDirectory, projectStatusCounts } from "./container-directory";

const list = (id: string, name: string, overrides: object = {}) =>
  ({
    id,
    name,
    kind: "list",
    availability: "active",
    deletedAt: null,
    description: null,
    createdAt: "2026-01-01",
    updatedAt: "2026-01-02",
    ...overrides,
  }) as unknown as TaskList;
const project = (id: string, name: string, overrides: object = {}) =>
  ({
    ...list(id, name),
    listId: "home",
    lifecycle: "open",
    targetDate: null,
    why: null,
    notes: null,
    ...overrides,
  }) as unknown as TaskProject;

const lists = [list("home", "Home"), list("old", "Old", { availability: "archived" })];
const projects = [
  project("open", "Open"),
  project("done", "Done", { lifecycle: "completed" }),
  project("dropped", "Dropped", { lifecycle: "cancelled" }),
  project("archived", "Archived", { lifecycle: "completed", availability: "archived" }),
  project("inherited", "Inherited", { lifecycle: "completed", listId: "old" }),
  project("deleted", "Deleted", { lifecycle: "completed", deletedAt: "2026-02-01" }),
];
const names = (rows: ReturnType<typeof containerDirectory>) => rows.map((row) => row.record.name);
const directory = (overrides: object) =>
  containerDirectory({ mode: "projects", search: "", lists, projects, ...overrides });

describe("container directory", () => {
  it("defaults Projects to open ones and reaches finished ones by status", () => {
    expect(names(directory({}))).toEqual(["Open"]);
    expect(names(directory({ status: "completed" }))).toEqual(["Done"]);
    expect(names(directory({ status: "cancelled" }))).toEqual(["Dropped"]);
    expect(names(directory({ status: "all" }))).toEqual(["Done", "Dropped", "Open"]);
  });
  it("leaves archived, inherited-archived and deleted projects to Archive and Trash", () => {
    expect(names(directory({ mode: "archive" }))).toEqual(["Archived", "Inherited", "Old"]);
    expect(projectStatusCounts(lists, projects)).toEqual({
      active: 1,
      completed: 1,
      cancelled: 1,
      all: 3,
    });
  });
  it("ignores status for Lists and matches descriptions, why and notes", () => {
    const described = [...lists, list("garden", "Garden", { description: "Spring beds" })];
    expect(
      names(
        directory({ mode: "lists", status: "completed", lists: described, search: " spring " }),
      ),
    ).toEqual(["Garden"]);
    const explained = [
      project("move", "Move", { why: "Settle before the lease ends" }),
      project("taxes", "Taxes", { notes: "Lease deduction paperwork" }),
      project("other", "Other"),
    ];
    expect(names(directory({ projects: explained, search: "LEASE" }))).toEqual(["Move", "Taxes"]);
  });
  it("orders by the saved preference with a stable name tie-break", () => {
    const dated = [
      project("b", "Beta", { targetDate: "2026-03-01", updatedAt: "2026-01-05" }),
      project("a", "Alpha", { updatedAt: "2026-01-09", createdAt: "2026-01-04" }),
      project("c", "Gamma", { targetDate: "2026-02-01", createdAt: "2026-01-08" }),
    ];
    const sorted = (sort: string) => names(directory({ projects: dated, sort }));
    expect(sorted("name")).toEqual(["Alpha", "Beta", "Gamma"]);
    expect(sorted("target")).toEqual(["Gamma", "Beta", "Alpha"]);
    expect(sorted("updated")).toEqual(["Alpha", "Beta", "Gamma"]);
    expect(sorted("newest")).toEqual(["Gamma", "Alpha", "Beta"]);
  });
});
