import { Fragment } from "react";
import { Link, useInRouterContext, useLocation } from "react-router-dom";
import { workspaceDefinitions } from "../navigation/manifest";
import { activeWorkspaceSection, workspaceSectionPages } from "../navigation/workspace-sections";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbSeparator,
} from "./ui/breadcrumb";
import type { WorkspaceAppBarWorkspace } from "./workspace-app-bar";

export function PageBreadcrumbs({
  items,
  label = "Page breadcrumbs",
}: {
  items: { label: string; to: string }[];
  label?: string;
}) {
  return (
    <Breadcrumb aria-label={label} className="workspace-page-breadcrumbs">
      <BreadcrumbList>
        {items.map((item, index) => (
          <Fragment key={item.to}>
            {index > 0 ? <BreadcrumbSeparator /> : null}
            <BreadcrumbItem>
              <BreadcrumbLink asChild>
                <Link to={item.to}>{item.label}</Link>
              </BreadcrumbLink>
            </BreadcrumbItem>
          </Fragment>
        ))}
      </BreadcrumbList>
    </Breadcrumb>
  );
}

export function WorkspaceBreadcrumbs({ workspace }: { workspace: WorkspaceAppBarWorkspace }) {
  const routed = useInRouterContext();
  return routed ? <RouteBreadcrumbs workspace={workspace} /> : null;
}

function RouteBreadcrumbs({ workspace }: { workspace: WorkspaceAppBarWorkspace }) {
  const { pathname, search } = useLocation();
  const owner = workspace === "account" ? "settings" : workspace;
  const definition = workspaceDefinitions.find((item) => item.id === workspace);
  const items = [{ label: definition?.label ?? "Settings", to: definition?.path ?? "/settings" }];
  const section = workspaceSectionPages(owner, search).find(
    (item) =>
      item.kind === "section" && item.id === activeWorkspaceSection(owner, pathname, search),
  );
  // The current section is already the large title on a section landing page.
  if (section && !new URLSearchParams(search).has("navigation")) {
    items.push({ label: section.label, to: section.path });
  }
  return <PageBreadcrumbs items={items} />;
}
