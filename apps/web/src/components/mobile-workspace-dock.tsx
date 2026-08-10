import {
  Check,
  ChevronDown,
  House,
  Layers3,
  LogOut,
  type LucideIcon,
  Settings,
  Sparkles,
} from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
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
import { mobileWorkspacePages } from "../navigation/mobile-workspace-dock.js";
import { WorkspaceIcon } from "./workspace-identity.js";

function DockWorkspaceIcon({ workspace }: { workspace: WorkspaceDefinition }) {
  if (workspace.id === "today") {
    return (
      <span aria-hidden="true" className="workspace-dock__identity-frame">
        <House />
      </span>
    );
  }
  return <WorkspaceIcon size="sm" workspace={workspace.id} />;
}

export function MobileWorkspaceDock({
  accountName,
  onLogout,
  workspaceDefinitions,
  pathname,
}: {
  accountName: string;
  onLogout: () => void;
  pathname: string;
  workspaceDefinitions: WorkspaceDefinition[];
}) {
  const [open, setOpen] = useState(false);
  const activeWorkspace = workspaceForLocation(pathname);
  if (!activeWorkspace) return null;
  const pages = mobileWorkspacePages(activeWorkspace.id);
  const workspaceLabel = activeWorkspace.label;
  const accountFirstName = accountName.trim().split(/\s+/)[0] || accountName;

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
              <DockWorkspaceIcon workspace={activeWorkspace} />
              <span>{workspaceLabel}</span>
              <ChevronDown aria-hidden="true" data-icon="inline-end" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="center"
            aria-label="Switch workspace"
            className="workspace-dock__workspace-menu"
            side="top"
          >
            {workspaceDefinitions.map((workspace) => {
              const selected = workspace.id === activeWorkspace.id;
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
                    {selected ? <Check aria-hidden="true" className="ml-auto" /> : null}
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
          <Layers3 aria-hidden="true" />
        </Button>
        <SheetContent
          aria-describedby="workspace-dock-sheet-description"
          aria-label={activeWorkspace.id === "today" ? "Today" : workspaceLabel}
          className="workspace-dock-sheet"
          side="bottom"
        >
          <SheetHeader>
            <SheetTitle>{activeWorkspace.id === "today" ? "Today" : workspaceLabel}</SheetTitle>
            <SheetDescription id="workspace-dock-sheet-description">
              Choose a page in {activeWorkspace.id === "today" ? "Today" : workspaceLabel}.
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
                  <ChevronDown aria-hidden="true" data-icon="inline-end" />
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
                    icon={Sparkles}
                    label="Setup"
                    onNavigate={() => setOpen(false)}
                    path="/setup"
                  />
                  <DockAccountMenuItem
                    icon={Settings}
                    label="Settings"
                    onNavigate={() => setOpen(false)}
                    path="/settings"
                  />
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={onLogout} variant="destructive">
                  <LogOut aria-hidden="true" /> Log out
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
  icon: LucideIcon;
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
