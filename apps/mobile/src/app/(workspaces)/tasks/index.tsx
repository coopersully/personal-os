import { TaskListScreen } from "../../../features/tasks/task-list";
export default function Page() {
  return (
    <TaskListScreen
      title="to-do"
      scope={{ view: "all", sort: "auto", status: "open", group: "none" }}
      initialFilters={{ due: "today" }}
    />
  );
}
