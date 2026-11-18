import { Stack } from "expo-router";
import type { WorkspaceWithPages } from "../navigation/workspace-pages";

// The persistent shell owns the dock; these stacks supply its real page destinations.
export function WorkspaceTabs({ workspace: _workspace }: { workspace: WorkspaceWithPages }) {
  return <Stack screenOptions={{ headerShown: false, animation: "none" }} />;
}
