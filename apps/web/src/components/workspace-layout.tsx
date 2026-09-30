import { createContext, type ReactNode, useState } from "react";

// Undefined means a standalone feature preview, rather than a mounted layout.
export const WorkspaceSecondarySlotContext = createContext<HTMLElement | null | undefined>(
  undefined,
);

/** Default workspace frame. Features retain ownership of their secondary controls. */
export function WorkspaceLayout({
  banner,
  children,
  primaryNavigation,
}: {
  banner?: ReactNode;
  children: ReactNode;
  primaryNavigation: ReactNode;
}) {
  const [secondarySlot, setSecondarySlot] = useState<HTMLDivElement | null>(null);
  return (
    <WorkspaceSecondarySlotContext.Provider value={secondarySlot}>
      <div className="workspace">
        {banner}
        {primaryNavigation}
        <div
          className="workspace-secondary-slot"
          data-slot="workspace-layout-secondary-navigation"
          ref={setSecondarySlot}
        />
        {children}
      </div>
    </WorkspaceSecondarySlotContext.Provider>
  );
}
