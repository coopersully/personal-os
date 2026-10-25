import { type ReactNode, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  FloatingActionButton,
  FloatingActionSurface,
  FloatingActions,
} from "@/components/floating-actions";
import { MenuIcon, XIcon } from "@/components/icons";
import { SidebarItemMeta } from "@/components/sidebar-item-meta";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
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
  const root = useRef<HTMLElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const previouslyOpen = useRef(false);
  useEffect(() => {
    if (open) panel.current?.focus();
    else if (previouslyOpen.current) trigger.current?.focus();
    previouslyOpen.current = open;
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [open]);
  return (
    <nav ref={root} aria-label="Workspace dock" className="workspace-dock">
      <FloatingActionSurface
        state={open ? "open" : "closed"}
        className="workspace-dock-surface"
        data-state={open ? "open" : "closed"}
      >
        {!open ? (
          <FloatingActions aria-label="Page navigation">
            <FloatingActionButton
              ref={trigger}
              label="Workspace actions"
              aria-haspopup="dialog"
              aria-expanded={open}
              onClick={() => setOpen(true)}
            >
              <MenuIcon aria-hidden="true" />
            </FloatingActionButton>
          </FloatingActions>
        ) : (
          <Card
            ref={panel}
            tabIndex={-1}
            role="dialog"
            aria-label={title}
            className="workspace-dock-menu"
            size="sm"
          >
            <CardHeader>
              <CardTitle>{title}</CardTitle>
              <CardAction>
                <Button
                  variant="ghost"
                  size="icon"
                  className="min-h-11 min-w-11"
                  aria-label="Close navigation"
                  onClick={() => setOpen(false)}
                >
                  <XIcon />
                </Button>
              </CardAction>
            </CardHeader>
            <CardContent>
              {renderWorkspaceNavigation ? (
                <div className="workspace-dock-sheet__navigation">
                  {renderWorkspaceNavigation(() => setOpen(false))}
                </div>
              ) : (
                <section className="workspace-dock-sheet__section" aria-label="Pages">
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
            </CardContent>
          </Card>
        )}
      </FloatingActionSurface>
    </nav>
  );
}
