import type { ReactNode } from "react";
import type { WorkspaceId } from "../navigation/manifest.js";

export type WorkspaceAppBarWorkspace = WorkspaceId | "account";

/**
 * The stable, page-wide frame for every workspace. Consumers supply semantic
 * content for the three slots; this component owns their order and geometry.
 */
export function WorkspaceAppBar({
  actions,
  context,
  identity,
  workspace,
}: {
  actions?: ReactNode;
  context?: ReactNode;
  identity?: ReactNode;
  workspace: WorkspaceAppBarWorkspace;
}) {
  return (
    <nav
      aria-label="Top navigation"
      className="workspace-app-bar"
      data-slot="workspace-app-bar"
      data-workspace={workspace}
    >
      <div className="workspace-app-bar__identity" data-slot="workspace-app-bar-identity">
        {identity}
      </div>
      <div className="workspace-app-bar__context" data-slot="workspace-app-bar-context">
        {context}
      </div>
      <div className="workspace-app-bar__actions" data-slot="workspace-app-bar-actions">
        {actions}
      </div>
    </nav>
  );
}
