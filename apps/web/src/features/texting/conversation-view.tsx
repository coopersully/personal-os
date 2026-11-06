import type { TextMessage } from "@personal-os/domain";
import { Fragment } from "react";
import { Link } from "react-router-dom";
import { DataViewEmpty } from "@/components/data-view-state";
import { ChevronDownIcon, ReplyIcon, SettingsIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { WorkspaceHeaderControls } from "@/components/workspace-header-controls";
import {
  WorkspaceIcon,
  type WorkspaceId,
  workspaceIdentities,
  workspaceIds,
} from "@/components/workspace-identity";
import { cn } from "@/lib/utils";

export type ConversationWorkspace = WorkspaceId;

export function conversationUrl(workspace?: WorkspaceId, preview?: string) {
  const params = new URLSearchParams();
  if (workspace) params.set("workspace", workspace);
  if (preview) params.set("preview", preview);
  return `/messages${params.size ? `?${params}` : ""}`;
}

export function ConversationNavigation({
  workspace,
  preview,
}: {
  workspace?: WorkspaceId | undefined;
  preview?: string | undefined;
}) {
  const suffix = preview ? `?preview=${preview}` : "";
  return (
    <WorkspaceHeaderControls label="Message views">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" aria-label="Message views">
            {workspace ? workspaceIdentities[workspace].label : "All messages"}
            <ChevronDownIcon data-icon="inline-end" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem asChild data-active={!workspace}>
            <Link to={`/messages${suffix}`} aria-current={!workspace ? "page" : undefined}>
              <ReplyIcon />
              All messages
            </Link>
          </DropdownMenuItem>
          {workspaceIds.map((id) => (
            <DropdownMenuItem key={id} asChild data-active={workspace === id}>
              <Link
                to={conversationUrl(id, preview)}
                aria-current={workspace === id ? "page" : undefined}
              >
                <WorkspaceIcon size="sm" workspace={id} />
                {workspaceIdentities[id].label}
              </Link>
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <Link to="/settings?page=texting">
              <SettingsIcon />
              Texting settings
            </Link>
          </DropdownMenuItem>
          {preview && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link to={conversationUrl(workspace, "messages-locked")}>Preview setup</Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link to={conversationUrl(workspace)}>Exit preview</Link>
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </WorkspaceHeaderControls>
  );
}

export function ConversationView({
  messages,
  workspace,
  timeZone,
  preview,
}: {
  messages: TextMessage[];
  workspace?: WorkspaceId | undefined;
  timeZone: string;
  preview?: string | undefined;
}) {
  const date = (value: string) =>
    new Intl.DateTimeFormat(undefined, {
      timeZone,
      month: "long",
      day: "numeric",
      year: "numeric",
    }).format(new Date(value));
  const time = (value: string) =>
    new Intl.DateTimeFormat(undefined, { timeZone, hour: "numeric", minute: "2-digit" }).format(
      new Date(value),
    );
  const byId = new Map(messages.map((message) => [message.id, message]));
  if (!messages.length)
    return (
      <DataViewEmpty
        icon={ReplyIcon}
        title={
          workspace
            ? `No ${workspaceIdentities[workspace].label} messages yet`
            : "Your conversation starts here"
        }
        description={
          workspace
            ? "Messages appear here when your agent connects them to this workspace."
            : "Text nohmi from your verified phone. Your messages and replies appear here."
        }
      >
        {workspace && (
          <Button variant="outline" asChild>
            <Link to={`/messages${preview ? `?preview=${preview}` : ""}`}>View all messages</Link>
          </Button>
        )}
      </DataViewEmpty>
    );
  return (
    <ol className="flex flex-col gap-4" aria-label="Conversation history">
      {messages.map((message, index) => {
        const human = message.senderKind === "human" || message.direction === "inbound";
        const system = message.senderKind === "system";
        const parent = message.replyToMessageIds?.map((id) => byId.get(id)).find(Boolean);
        const previous = messages[index - 1];
        const firstOfDay = !previous || date(previous.occurredAt) !== date(message.occurredAt);
        return (
          <Fragment key={message.id}>
            {firstOfDay && (
              <li className="py-1 text-center text-xs text-muted-foreground">
                <time dateTime={message.occurredAt}>{date(message.occurredAt)}</time>
              </li>
            )}
            <li
              id={`message-${message.id}`}
              tabIndex={-1}
              aria-label={system ? "System event" : undefined}
              className={cn(
                "flex min-w-0 flex-col gap-1.5 scroll-mt-24",
                system ? "items-center py-2 text-center" : human ? "items-end" : "items-start",
              )}
            >
              {!system && (
                <div className="flex max-w-[92%] items-center gap-2 px-1 text-xs text-muted-foreground">
                  <span className="shrink-0 font-medium">{human ? "You" : "Your agent"}</span>
                  {parent && (
                    <a
                      className="flex min-w-0 items-center gap-1 hover:text-foreground"
                      href={`#message-${parent.id}`}
                      aria-label={
                        parent.id === previous?.id
                          ? "Reply to previous message"
                          : `Reply to: ${parent.text}`
                      }
                    >
                      <ReplyIcon className="size-3 shrink-0" aria-hidden="true" />
                      {parent.id !== previous?.id && (
                        <span className="truncate">{parent.text}</span>
                      )}
                    </a>
                  )}
                </div>
              )}
              <div
                className={cn(
                  system
                    ? "max-w-lg whitespace-pre-wrap break-words text-xs leading-relaxed text-muted-foreground"
                    : "flex max-w-[92%] flex-col gap-2 whitespace-pre-wrap break-words rounded-2xl px-4 py-3 text-sm leading-relaxed sm:max-w-[85%]",
                  human
                    ? "bg-primary text-primary-foreground"
                    : system
                      ? ""
                      : "bg-card text-card-foreground",
                )}
              >
                <p>{message.text || "Message without text"}</p>
              </div>
              <div
                className={cn(
                  "flex max-w-full flex-wrap items-center gap-x-2 gap-y-1 px-1 text-xs text-muted-foreground",
                  human && "justify-end",
                )}
              >
                <time dateTime={message.occurredAt}>{time(message.occurredAt)}</time>
                {!human && !system && (
                  <span>
                    {message.status === "unknown"
                      ? "Delivery unconfirmed"
                      : message.status === "delivered"
                        ? "Delivered"
                        : message.status}
                  </span>
                )}
                {!system &&
                  message.workspaces?.map((id) => (
                    <Link
                      key={id}
                      className="rounded-sm px-1 hover:bg-selection hover:text-foreground"
                      to={conversationUrl(id, preview)}
                    >
                      {workspaceIdentities[id].label}
                    </Link>
                  ))}
                {workspace && (message.workspaces?.length ?? 0) > 1 && (
                  <Link
                    className="rounded-sm px-1 underline underline-offset-2 hover:text-foreground"
                    to={`/messages${preview ? `?preview=${preview}` : ""}#message-${message.id}`}
                  >
                    Full conversation
                  </Link>
                )}
              </div>
            </li>
          </Fragment>
        );
      })}
    </ol>
  );
}
