import { TaskListScreen } from "../../../features/tasks/task-list";
export default function Page() {
  return <TaskListScreen title="today" scope={{ view: "today" }} />;
}
