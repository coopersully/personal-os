import type { ReactNode } from "react";

/** Page controls stay directly accessible; the shared header owns available space. */
export function WorkspaceHeaderOptions({ children }: { children: ReactNode }) {
  return <div className="workspace-header-options">{children}</div>;
}
