import type { ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { WorkspaceHeaderOptions } from "@/components/workspace-header-options";
import { MailLayoutControl } from "./layout-control";
import { isMailListScope, mailListScopeFromSearch, mailListScopeParams } from "./mail";
export function MailAppBarControls({
  sync,
  search,
  accounts,
}: {
  sync: ReactNode;
  search: ReactNode;
  accounts: ReactNode;
}) {
  return (
    <div className="mail-app-bar__controls">
      {search}
      {accounts}
      <WorkspaceHeaderOptions>
        <MailLayoutControl />
        {sync}
      </WorkspaceHeaderOptions>
    </div>
  );
}

/** The title changes mailbox scope while retaining account and search filters. */
export function MailAppBarTitle() {
  const [params, setParams] = useSearchParams();
  const scope = mailListScopeFromSearch(params);
  const views = {
    all: "Inbox",
    unread: "Unread",
    starred: "Starred",
    snoozed: "Snoozed",
    sent: "Sent",
    drafts: "Drafts",
  };
  const label = params.has("mailbox") ? "Mailbox" : views[scope];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="workspace-app-bar__title"
          aria-label={`Mail view: ${label}`}
        >
          {label}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuRadioGroup
          value={params.has("mailbox") ? "" : scope}
          onValueChange={(value) => {
            if (!isMailListScope(value)) return;
            setParams((current) => {
              const next = new URLSearchParams(current);
              next.delete("thread");
              next.delete("mailbox");
              for (const [key, entry] of Object.entries(mailListScopeParams(value))) {
                if (entry) next.set(key, entry);
                else next.delete(key);
              }
              return next;
            });
          }}
        >
          {Object.entries(views).map(([value, name]) => (
            <DropdownMenuRadioItem key={value} value={value}>
              {name}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
