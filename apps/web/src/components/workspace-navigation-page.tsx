import { createContext, type ReactNode, useContext } from "react";
import { Card } from "@/components/ui/card";

const NavigationShortcutsContext = createContext<string[]>([]);
export const useNavigationShortcuts = () => useContext(NavigationShortcutsContext);

const NavigationSectionContext = createContext<string | null>(null);
export const useNavigationSection = () => useContext(NavigationSectionContext);

/** Reuses the domain's actual navigation, permissions, destinations, and counts. */
export function WorkspaceNavigationPage({
  section,
  children,
  shortcuts = [],
}: {
  section: string;
  children: ReactNode;
  shortcuts?: string[];
}) {
  return (
    <NavigationSectionContext.Provider value={section}>
      <NavigationShortcutsContext.Provider value={shortcuts}>
        <div className="workspace-navigation-page narrow-page">
          <Card>{children}</Card>
        </div>
      </NavigationShortcutsContext.Provider>
    </NavigationSectionContext.Provider>
  );
}
