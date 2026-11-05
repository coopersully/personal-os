import { activeWorkspaceSection, workspaceSectionPages } from "./workspace-sections";

it.each([
  "mail",
  "tasks",
  "calendar",
  "finances",
])("keeps %s messages a workspace destination", (workspace) => {
  const pages = workspaceSectionPages(workspace, "");
  expect(pages.find((page) => page.id === "messages")).toMatchObject({
    path: `/${workspace}/messages`,
    kind: "destination",
  });
  expect(activeWorkspaceSection(workspace, `/${workspace}/messages`, "")).toBe("messages");
  expect(pages.some((page) => page.id !== "messages" && page.kind === "destination")).toBe(true);
});
it("keeps account utilities outside workspace message navigation", () => {
  expect(workspaceSectionPages("settings", "").some((page) => page.id === "messages")).toBe(false);
});
