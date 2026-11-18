import { Stack } from "expo-router";
import type { WorkspaceWithPages } from "../navigation/workspace-pages";

/** A count on a page's tab, with the words a screen reader says for it. */
export type WorkspaceTabBadges = Partial<Record<string, { value: string; label: string }>>;

// The persistent shell owns the dock; these stacks supply its real page destinations.
export function WorkspaceTabs({
  workspace: _workspace,
}: {
  workspace: WorkspaceWithPages;
  /** Shown by the native tab bar; this fallback has no tab bar of its own. */
  badges?: WorkspaceTabBadges;
}) {
  return <Stack screenOptions={{ headerShown: false, animation: "none" }} />;
}
