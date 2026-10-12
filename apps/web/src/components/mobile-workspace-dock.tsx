import { type ReactNode, useState } from "react";
import { Link } from "react-router-dom";
import { FloatingActionButton, FloatingActions } from "@/components/floating-actions";
import { LayersIcon } from "@/components/icons";
import { SidebarItemMeta } from "@/components/sidebar-item-meta";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { MobileWorkspacePage } from "../navigation/mobile-workspace-dock.js";

export function MobileWorkspaceDock({
  pages,
  renderWorkspaceNavigation,
  title,
}: {
  pages: MobileWorkspacePage[];
  renderWorkspaceNavigation?: (onNavigate: () => void) => ReactNode;
  title: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <nav aria-label="Workspace dock" className="workspace-dock">
      <Sheet open={open} onOpenChange={setOpen}>
        <FloatingActions aria-label="Page navigation">
          <FloatingActionButton label="Workspace actions" onClick={() => setOpen(true)}>
            <LayersIcon aria-hidden="true" />
          </FloatingActionButton>
        </FloatingActions>
        <SheetContent
          aria-describedby="workspace-dock-sheet-description"
          aria-label={title}
          className="workspace-dock-sheet"
          side="bottom"
        >
          <SheetHeader>
            <SheetTitle>{title}</SheetTitle>
            <SheetDescription id="workspace-dock-sheet-description">
              Choose a page in {title}.
            </SheetDescription>
          </SheetHeader>
          {renderWorkspaceNavigation ? (
            <div className="workspace-dock-sheet__navigation">
              {renderWorkspaceNavigation(() => setOpen(false))}
            </div>
          ) : (
            <section
              className="workspace-dock-sheet__section"
              aria-labelledby="workspace-dock-pages"
            >
              <h2 id="workspace-dock-pages">Pages</h2>
              <ItemGroup className="workspace-dock-sheet__items">
                {pages.map((page) => (
                  <Item asChild key={page.path} size="xs" className="min-h-11 flex-nowrap">
                    <Link
                      aria-label={page.badge ? `${page.label}: ${page.badge}` : undefined}
                      onClick={() => setOpen(false)}
                      to={page.path}
                    >
                      <ItemMedia variant="icon">
                        <page.icon aria-hidden="true" />
                      </ItemMedia>
                      <ItemContent>
                        <ItemTitle className="block truncate">{page.label}</ItemTitle>
                      </ItemContent>
                      {page.badge || page.count !== undefined ? (
                        <ItemActions>
                          <SidebarItemMeta
                            inline
                            attention={Boolean(page.badge)}
                            count={page.count}
                            label={page.label}
                          />
                        </ItemActions>
                      ) : null}
                    </Link>
                  </Item>
                ))}
              </ItemGroup>
            </section>
          )}
        </SheetContent>
      </Sheet>
    </nav>
  );
}
