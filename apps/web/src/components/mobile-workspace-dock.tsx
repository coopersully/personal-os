import type { CSSProperties } from "react";
import { Link } from "react-router-dom";
import type { MobileWorkspacePage } from "../navigation/mobile-workspace-dock.js";

/** Every tab opens a sidebar section as a normal page, with native history/back behavior. */
export function MobileWorkspaceDock({
  pages,
  activeSection,
  workspace,
}: {
  pages: MobileWorkspacePage[];
  activeSection: string;
  workspace: string;
}) {
  if (!pages.length) return null;
  const selectedIndex = pages.findIndex((page) => page.id === activeSection);
  return (
    <>
      <div aria-hidden="true" className="workspace-app-bar-backdrop" />
      <nav
        aria-label="Workspace sections"
        className="workspace-dock workspace-app-tabs"
        data-workspace={workspace}
        data-has-selection={selectedIndex >= 0}
        style={
          {
            "--navigation-item-count": pages.length,
            "--navigation-selected-index": Math.max(0, selectedIndex),
          } as CSSProperties
        }
      >
        {pages.map((page) => (
          <Link
            key={page.id}
            to={page.path}
            aria-current={activeSection === page.id ? "page" : undefined}
          >
            <page.icon
              aria-hidden="true"
              weight={activeSection === page.id ? "Filled" : "Outline"}
            />
            <span>{page.label}</span>
          </Link>
        ))}
      </nav>
    </>
  );
}
