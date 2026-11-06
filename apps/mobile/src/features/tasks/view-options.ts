import type { TaskWorkspaceQuery } from "@personal-os/domain";
import type { OptionsMenuProps } from "./options-menu";
export function buildViewOptions(
  query: Partial<TaskWorkspaceQuery>,
  scope: Partial<TaskWorkspaceQuery> = {},
): OptionsMenuProps["choices"] {
  const options = (values: string[]) =>
    values.map((value) => ({
      value,
      label:
        (
          {
            default: "Recommended",
            open_and_completed: "Open & completed",
            date: "Due date",
            reserved: "Reserved time",
            newest: "Newest first",
            oldest: "Oldest first",
            title: "Title (A–Z)",
            estimate: "Estimated duration",
            dated: "Has a due date",
            none: "None",
            any: "Any",
            all: "All",
            archived: "Archived",
          } as Record<string, string>
        )[value] ?? value.replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase()),
    }));
  return [
    ...(!query.listId && !query.projectId && !scope.kind
      ? [
          {
            key: "kind" as const,
            label: "Type",
            value: query.kind ?? "all",
            section: "filter" as const,
            options: [
              { value: "all", label: "Tasks & reminders" },
              { value: "task", label: "Tasks" },
              { value: "reminder", label: "Reminders" },
            ],
          },
        ]
      : []),
    {
      key: "status",
      label: "Status",
      value: query.status ?? "",
      section: "filter",
      options: [
        { value: "", label: "View default" },
        ...options(["all", "open", "open_and_completed", "completed", "cancelled", "archived"]),
      ],
    },
    {
      key: "priority",
      label: "Priority",
      value: query.priority ?? "",
      section: "filter",
      options: [{ value: "", label: "Any" }, ...options(["high", "medium", "low"])],
    },
    {
      key: "due",
      label: "Due",
      value: query.due ?? "any",
      section: "filter",
      options: options(["any", "overdue", "dated", "none"]),
    },
    {
      key: "reserved",
      label: "Reserved time",
      value: query.reserved ?? "any",
      section: "filter",
      options: options(["any", "scheduled", "none"]),
    },
    {
      key: "sort",
      label: "Sort by",
      value: query.sort ?? "default",
      section: "presentation",
      options: options([
        "default",
        "date",
        "reserved",
        "priority",
        "newest",
        "oldest",
        "title",
        "estimate",
      ]),
    },
    {
      key: "group",
      label: "Group by",
      value: query.group ?? "none",
      section: "presentation",
      options: options(["none", "date", "list", "project"]),
    },
  ];
}
