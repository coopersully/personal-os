import { createContext, useContext } from "react";

/** Space reserved inside page content for the transparent, fixed workspace search header. */
export const WorkspaceHeaderInset = createContext(0);
export const useWorkspaceHeaderInset = () => useContext(WorkspaceHeaderInset);

export const WorkspaceHeroVisibility = createContext<{ current: (visible: boolean) => void }>({
  current: () => {},
});
