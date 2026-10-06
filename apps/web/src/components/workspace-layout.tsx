import { createContext, type Dispatch, type ReactNode, type SetStateAction, useState } from "react";

// Undefined means a standalone feature preview, rather than a mounted layout.
export const WorkspaceSecondarySlotContext = createContext<HTMLElement | null | undefined>(
  undefined,
);

export const WorkspaceHeaderSlotContext = createContext<
  | {
      target: HTMLElement | null;
      leadingTarget: HTMLElement | null;
      setLeadingTarget: Dispatch<SetStateAction<HTMLDivElement | null>>;
      setTarget: Dispatch<SetStateAction<HTMLDivElement | null>>;
    }
  | undefined
>(undefined);

/**
 * Intrinsic chrome plus content. Pane workspaces own their inner scroll regions;
 * page workspaces use the shell/document scroller. Spatial axes stay inline.
 */
export function WorkspaceLayout({
  banner,
  children,
  primaryNavigation,
  contentMode = "page",
}: {
  contentMode?: "page" | "panes";
  banner?: ReactNode;
  children: ReactNode;
  primaryNavigation: ReactNode;
}) {
  const [secondarySlot, setSecondarySlot] = useState<HTMLDivElement | null>(null);
  const [leadingSlot, setLeadingSlot] = useState<HTMLDivElement | null>(null);
  const [headerSlot, setHeaderSlot] = useState<HTMLDivElement | null>(null);
  return (
    <WorkspaceHeaderSlotContext.Provider
      value={{
        target: headerSlot,
        setTarget: setHeaderSlot,
        leadingTarget: leadingSlot,
        setLeadingTarget: setLeadingSlot,
      }}
    >
      <WorkspaceSecondarySlotContext.Provider value={secondarySlot}>
        <div className="workspace" data-content-mode={contentMode}>
          <div className="workspace-chrome">
            {banner}
            {primaryNavigation}
            <div
              className="workspace-secondary-slot"
              data-slot="workspace-layout-secondary-navigation"
              ref={setSecondarySlot}
            />
          </div>
          {children}
        </div>
      </WorkspaceSecondarySlotContext.Provider>
    </WorkspaceHeaderSlotContext.Provider>
  );
}
