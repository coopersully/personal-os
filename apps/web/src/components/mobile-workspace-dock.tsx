import { type ReactNode, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { MenuIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";
import type { MobileWorkspacePage } from "../navigation/mobile-workspace-dock.js";

/** Stable shortcuts stay visible; the drawer holds the complete workspace hierarchy. */
export function MobileWorkspaceDock({
  pages,
  activeSearch,
  renderWorkspaceNavigation,
  title,
}: {
  pages: MobileWorkspacePage[];
  activeSearch?: string;
  renderWorkspaceNavigation?: (onNavigate: () => void) => ReactNode;
  title: string;
}) {
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const current = new URLSearchParams(activeSearch ?? location.search);
  const isActive = (path: string) => {
    const [pathname, search] = path.split("?");
    if (location.pathname !== pathname) return false;
    if (
      pathname === "/tasks" &&
      ((current.get("view") && current.get("view") !== "all") ||
        current.has("list") ||
        current.has("project"))
    )
      return false;
    const params = new URLSearchParams(search);
    return [...params].every(
      ([key, value]) =>
        (current.get(key) ?? (key === "scope" ? "inbox" : key === "page" ? "profile" : "")) ===
        value,
    );
  };
  const destination = (path: string) => {
    if (location.pathname !== "/mail" || !path.startsWith("/mail?")) return path;
    const [pathname, search] = path.split("?");
    const params = new URLSearchParams(search);
    for (const key of ["account", "q"])
      for (const value of current.getAll(key)) params.append(key, value);
    return `${pathname}?${params}`;
  };
  const primary = pages.slice(0, 3);
  const moreActive = !primary.some((page) => isActive(page.path));
  return (
    <>
      <div aria-hidden="true" className="workspace-app-bar-backdrop" />
      <nav aria-label="Workspace dock" className="workspace-dock workspace-app-tabs">
        {primary.map((page) => (
          <Link
            key={page.path}
            to={destination(page.path)}
            aria-current={isActive(page.path) ? "page" : undefined}
          >
            <page.icon aria-hidden="true" />
            <span>{page.label}</span>
          </Link>
        ))}
        {renderWorkspaceNavigation || pages.length > primary.length ? (
          <Drawer open={open} onOpenChange={setOpen}>
            <DrawerTrigger asChild>
              <Button
                variant="ghost"
                aria-label="Workspace actions"
                data-active={moreActive || undefined}
              >
                <MenuIcon aria-hidden="true" />
                <span>more</span>
              </Button>
            </DrawerTrigger>
            <DrawerContent className="workspace-dock-sheet">
              <DrawerHeader>
                <DrawerTitle>{title}</DrawerTitle>
                <DrawerDescription>all pages in this workspace</DrawerDescription>
              </DrawerHeader>
              <div
                data-vaul-no-drag
                className="workspace-dock-sheet__navigation overflow-y-auto pb-6"
              >
                {renderWorkspaceNavigation
                  ? renderWorkspaceNavigation(() => setOpen(false))
                  : pages.map((page) => (
                      <Button
                        asChild
                        variant="ghost"
                        key={page.path}
                        className="flex min-h-11 w-full justify-start"
                      >
                        <Link
                          aria-label={page.badge ? `${page.label}: ${page.badge}` : undefined}
                          to={destination(page.path)}
                          onClick={() => setOpen(false)}
                          aria-current={isActive(page.path) ? "page" : undefined}
                        >
                          <page.icon aria-hidden="true" />
                          <span>{page.label}</span>
                          {page.badge || page.count ? (
                            <span className="ml-auto">{page.badge ?? page.count}</span>
                          ) : null}
                        </Link>
                      </Button>
                    ))}
              </div>
            </DrawerContent>
          </Drawer>
        ) : null}
      </nav>
    </>
  );
}
