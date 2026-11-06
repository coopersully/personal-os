import { Redirect, useLocalSearchParams } from "expo-router";
export default function Page() {
  const { reminder } = useLocalSearchParams<{ reminder?: string }>();
  return (
    <Redirect
      href={
        reminder
          ? { pathname: "/task-editor", params: { id: reminder, kind: "reminder" } }
          : {
              pathname: "/task-browser",
              params: { view: "all", kind: "reminder", title: "reminders" },
            }
      }
    />
  );
}
