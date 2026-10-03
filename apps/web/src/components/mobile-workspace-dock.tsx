import type { WeatherSnapshot } from "@personal-os/domain";
import { type ReactNode, useState } from "react";
import { Link } from "react-router-dom";
import { FloatingActionButton, FloatingActions } from "@/components/floating-actions";
import { CheckIcon, ChevronDownIcon, LayersIcon, SettingsIcon } from "@/components/icons";
import { SidebarItemMeta } from "@/components/sidebar-item-meta";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { type WorkspaceDefinition, workspaceForLocation } from "../navigation/manifest.js";
import {
  type MobileWorkspacePage,
  mobileWorkspacePages,
} from "../navigation/mobile-workspace-dock.js";
import { TodayWorkspaceIcon } from "./today-workspace-icon.js";
import { WorkspaceIcon } from "./workspace-identity.js";

function DockWorkspaceIcon({
  timeZone,
  weather,
  workspace,
}: {
  timeZone: string;
  weather: WeatherSnapshot | undefined;
  workspace: WorkspaceDefinition;
}) {
  if (workspace.id === "today") {
    return <TodayWorkspaceIcon timeZone={timeZone} weather={weather} />;
  }
  return <WorkspaceIcon size="sm" workspace={workspace.id} />;
}

/** Account administration is neutral: it never borrows a workspace identity. */
function DockAccountIcon() {
  return (
    <span aria-hidden="true" className="workspace-dock__identity-frame">
      <SettingsIcon />
    </span>
  );
}

export function MobileWorkspaceDock({
  showWorkspaceSwitcher = true,
  accountSections,
  renderWorkspaceNavigation,
  pathname,
  planningTimezone,
  weather,
  workspaceDefinitions,
}: {
  showWorkspaceSwitcher?: boolean;
  accountSections: MobileWorkspacePage[];
  pathname: string;
  renderWorkspaceNavigation?: (onNavigate: () => void) => ReactNode;
  planningTimezone: string;
  weather: WeatherSnapshot | undefined;
  workspaceDefinitions: WorkspaceDefinition[];
}) {
  const [open, setOpen] = useState(false);
  // The dock only renders inside the shell, where every route is owned by a
  // workspace or by the account utility. An absent workspace therefore means
  // account administration, which names where you are without joining the
  // switcher: the five workspace destinations stay the only way to change
  // workspace.
  const activeWorkspace = workspaceForLocation(pathname);
  const pages = activeWorkspace ? mobileWorkspacePages(activeWorkspace.id) : accountSections;
  const pillLabel = activeWorkspace ? activeWorkspace.label : "Settings";
  const sheetLabel = activeWorkspace
    ? activeWorkspace.id === "today"
      ? "Today"
      : activeWorkspace.label
    : "Settings";

  return (
    <nav aria-label="Workspace dock" className="workspace-dock">
      {showWorkspaceSwitcher ? (
        <div className="workspace-dock__pill">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                aria-label="Switch workspace"
                className="workspace-dock__workspace-trigger"
                variant="ghost"
              >
                {activeWorkspace ? (
                  <DockWorkspaceIcon
                    timeZone={planningTimezone}
                    weather={weather}
                    workspace={activeWorkspace}
                  />
                ) : (
                  <DockAccountIcon />
                )}
                <span>{pillLabel}</span>
                <ChevronDownIcon aria-hidden="true" data-icon="inline-end" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="center"
              aria-label="Switch workspace"
              className="workspace-dock__workspace-menu"
              side="top"
            >
              <DropdownMenuGroup>
                {workspaceDefinitions.map((workspace) => {
                  const selected = workspace.id === activeWorkspace?.id;
                  return (
                    <DropdownMenuItem asChild key={workspace.id}>
                      <Link
                        aria-current={selected ? "page" : undefined}
                        aria-label={workspace.label}
                        to={workspace.path}
                      >
                        <DockWorkspaceIcon
                          timeZone={planningTimezone}
                          weather={weather}
                          workspace={workspace}
                        />
                        <span>{workspace.label}</span>
                        {selected ? <CheckIcon aria-hidden="true" className="ml-auto" /> : null}
                      </Link>
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuItem asChild>
                  <Link
                    aria-current={activeWorkspace ? undefined : "page"}
                    aria-label="Settings"
                    to="/settings"
                  >
                    <SettingsIcon aria-hidden="true" />
                    <span>Settings</span>
                    {activeWorkspace ? null : <CheckIcon aria-hidden="true" className="ml-auto" />}
                  </Link>
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ) : null}
      <Sheet open={open} onOpenChange={setOpen}>
        <FloatingActions aria-label="Page navigation">
          <FloatingActionButton label="Workspace actions" onClick={() => setOpen(true)}>
            <LayersIcon aria-hidden="true" />
          </FloatingActionButton>
        </FloatingActions>
        <SheetContent
          aria-describedby="workspace-dock-sheet-description"
          aria-label={sheetLabel}
          className="workspace-dock-sheet"
          side="bottom"
        >
          <SheetHeader>
            <SheetTitle>{sheetLabel}</SheetTitle>
            <SheetDescription id="workspace-dock-sheet-description">
              Choose a page in {sheetLabel}.
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
