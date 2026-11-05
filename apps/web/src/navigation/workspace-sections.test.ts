import { workspaceSectionPages } from "./workspace-sections";

it.each([
  "mail",
  "tasks",
  "calendar",
  "finances",
])("keeps Messages outside the %s workspace", (workspace) => {
  const pages = workspaceSectionPages(workspace, "");
  expect(pages.some((page) => page.id === "messages")).toBe(false);
  if (workspace === "calendar") expect(pages).toEqual([]);
  else expect(pages.some((page) => page.kind === "destination")).toBe(true);
});
it("keeps account utilities outside workspace message navigation", () => {
  expect(workspaceSectionPages("settings", "").some((page) => page.id === "messages")).toBe(false);
});
