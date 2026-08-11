import { useState } from "react";
import { Link } from "react-router-dom";
import {
  CheckIcon,
  ChevronDownIcon,
  HouseIcon,
  type Icon,
  LayersIcon,
  LogOutIcon,
  SettingsIcon,
  SparklesIcon,
} from "@/components/icons";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Item, ItemContent, ItemGroup, ItemMedia, ItemTitle } from "@/components/ui/item";
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
import { WorkspaceIcon } from "./workspace-identity.js";

function DockWorkspaceIcon({ workspace }: { workspace: WorkspaceDefinition }) {
  if (workspace.id === "today") {
    return (
      <span aria-hidden="true" className="workspace-dock__identity-frame">
        <HouseIcon />
      </span>
    );
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
  accountName,
  accountSections,
  onLogout,
  workspaceDefinitions,
  pathname,
}: {
  accountName: string;
  accountSections: MobileWorkspacePage[];
  onLogout: () => void;
  pathname: string;
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
  // The shell resolves a non-empty account name before it reaches the dock.
  const accountFirstName = accountName.trim().split(/\s+/)[0];

  return (
    <nav aria-label="Workspace dock" className="workspace-dock">
      <div className="workspace-dock__pill">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              aria-label="Switch workspace"
              className="workspace-dock__workspace-trigger"
              variant="ghost"
            >
              {activeWorkspace ? (
                <DockWorkspaceIcon workspace={activeWorkspace} />
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
            {workspaceDefinitions.map((workspace) => {
              const selected = workspace.id === activeWorkspace?.id;
              const descriptionId = `workspace-dock-description-${workspace.id}`;
              return (
                <DropdownMenuItem asChild key={workspace.id}>
                  <Link
                    aria-current={selected ? "page" : undefined}
                    aria-describedby={descriptionId}
                    aria-label={workspace.label}
                    to={workspace.path}
                  >
                    <DockWorkspaceIcon workspace={workspace} />
                    <span className="workspace-dock__workspace-copy">
                      <span>{workspace.label}</span>
                      <small id={descriptionId}>{workspace.description}</small>
                    </span>
                    {selected ? <CheckIcon aria-hidden="true" className="ml-auto" /> : null}
                  </Link>
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <Sheet open={open} onOpenChange={setOpen}>
        <Button
          aria-label="Workspace actions"
          className="workspace-dock__actions workspace-dock__actions--bubble"
          onClick={() => setOpen(true)}
          size="icon"
          variant="default"
        >
          <LayersIcon aria-hidden="true" />
        </Button>
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
          <section className="workspace-dock-sheet__section" aria-labelledby="workspace-dock-pages">
            <h2 id="workspace-dock-pages">Pages</h2>
            <ItemGroup className="workspace-dock-sheet__items">
              {pages.map((page) => (
                <Item asChild key={page.path} size="xs">
                  <Link onClick={() => setOpen(false)} to={page.path}>
                    <ItemMedia variant="icon">
                      <page.icon aria-hidden="true" />
                    </ItemMedia>
                    <ItemContent>
                      <ItemTitle>{page.label}</ItemTitle>
                    </ItemContent>
                  </Link>
                </Item>
              ))}
            </ItemGroup>
          </section>
          <div className="workspace-dock-sheet__account">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button aria-label={`${accountFirstName} account`} variant="ghost">
                  {accountFirstName}
                  <ChevronDownIcon aria-hidden="true" data-icon="inline-end" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="start"
                aria-label={`${accountFirstName} account`}
                side="top"
              >
                <DropdownMenuLabel>{accountName}</DropdownMenuLabel>
                <DropdownMenuGroup>
                  <DockAccountMenuItem
                    icon={SparklesIcon}
                    label="Setup"
                    onNavigate={() => setOpen(false)}
                    path="/setup"
                  />
                  <DockAccountMenuItem
                    icon={SettingsIcon}
                    label="Settings"
                    onNavigate={() => setOpen(false)}
                    path="/settings"
                  />
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={onLogout} variant="destructive">
                  <LogOutIcon aria-hidden="true" /> Log out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </SheetContent>
      </Sheet>
    </nav>
  );
}

function DockAccountMenuItem({
  icon: Icon,
  label,
  onNavigate,
  path,
}: {
  icon: Icon;
  label: string;
  onNavigate: () => void;
  path: string;
}) {
  return (
    <DropdownMenuItem asChild>
      <Link onClick={onNavigate} to={path}>
        <Icon aria-hidden="true" />
        {label}
      </Link>
    </DropdownMenuItem>
  );
}
