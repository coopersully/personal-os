import type { ReactNode } from "react";
import type { WorkspaceId } from "../navigation/manifest.js";
import { WorkspaceBreadcrumbs } from "./workspace-breadcrumbs";
import { WorkspaceHeaderControlsSlot } from "./workspace-header-controls";

export type WorkspaceAppBarWorkspace = WorkspaceId | "account";

/**
 * The stable, page-wide frame for every workspace. Consumers supply semantic
 * identity, context, attention, utilities, and creation; this component owns
 * their order and responsive geometry. Primary actions remain mounted on resize.
 */
export function WorkspaceAppBar({
  actions,
  attention,
  primaryActions,
  context,
  identity,
  title,
  workspace,
}: {
  actions?: ReactNode;
  attention?: ReactNode;
  primaryActions?: ReactNode;
  context?: ReactNode;
  identity?: ReactNode;
  title?: ReactNode;
  workspace: WorkspaceAppBarWorkspace;
}) {
  return (
    <nav
      aria-label="Top navigation"
      className="workspace-app-bar"
      data-slot="workspace-app-bar"
      data-workspace={workspace}
      data-header-layout={title ? "sentence" : undefined}
    >
      {title ? (
        <div className="workspace-app-bar__page-title" data-slot="workspace-app-bar-title">
          <WorkspaceBreadcrumbs workspace={workspace} />
          {title}
        </div>
      ) : null}
      <div className="workspace-app-bar__identity" data-slot="workspace-app-bar-identity">
        {identity}
      </div>
      <div className="workspace-app-bar__context" data-slot="workspace-app-bar-context">
        {context}
        <WorkspaceHeaderControlsSlot placement="workspace" />
      </div>
      {title && workspace !== "today" ? (
        <div className="workspace-app-bar__page-actions" data-slot="workspace-app-bar-page-actions">
          <WorkspaceHeaderControlsSlot placement="leading" />
          <WorkspaceHeaderControlsSlot />
        </div>
      ) : null}
      <div className="workspace-app-bar__actions" data-slot="workspace-app-bar-actions">
        {actions}
        {attention}
        {primaryActions ? (
          <div className="workspace-primary-actions" data-slot="workspace-primary-actions">
            {primaryActions}
          </div>
        ) : null}
      </div>
    </nav>
  );
}
