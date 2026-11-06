import { taskWorkspaceQuerySchema } from "@personal-os/domain";
import { Stack, useLocalSearchParams } from "expo-router";
import { TaskListScreen } from "../features/tasks/task-list";
import { State } from "../features/tasks/ui";
export default function Page() {
  const params = useLocalSearchParams();
  const parsed = taskWorkspaceQuerySchema.safeParse(params);
  if (!parsed.success) return <State empty="This task link is invalid." />;
  const title = typeof params.title === "string" ? params.title : "tasks";
  return (
    <>
      <Stack.Screen options={{ title }} />
      <TaskListScreen title={title} scope={parsed.data} standalone />
    </>
  );
}
