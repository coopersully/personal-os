import { Stack } from "expo-router";
import type { WorkspaceWithPages } from "../navigation/workspace-pages";
import { RefreshScope } from "./refresh-context";

// The persistent shell owns the dock; these stacks supply its real page destinations.
export function WorkspaceTabs({ workspace }: { workspace: WorkspaceWithPages }) {
  return (
    <RefreshScope.Provider value={[workspace]}>
      <Stack screenOptions={{ headerShown: false, animation: "none" }} />
    </RefreshScope.Provider>
  );
}
