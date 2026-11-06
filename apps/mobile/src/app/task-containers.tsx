import { Stack, useLocalSearchParams } from "expo-router";
import { TasksHub } from "../features/tasks/hub";
export default function Page() {
  const { mode } = useLocalSearchParams();
  const value = mode === "projects" ? "projects" : mode === "archive" ? "archive" : "lists";
  return (
    <>
      <Stack.Screen options={{ title: value }} />
      <TasksHub mode={value} />
    </>
  );
}
