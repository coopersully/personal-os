import type { CalendarAccount } from "@personal-os/api-client";
import type { LegacyMailDraft, Mailbox, MailMessage, MailThread, User } from "@personal-os/domain";
import { Badge, Button, EmptyState } from "@personal-os/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  ArchiveIcon,
  ChevronDownIcon,
  ClockIcon,
  DownloadIcon,
  EyeIcon,
  EyeOffIcon,
  InboxIcon,
  MailIcon,
  MoreHorizontalIcon,
  SearchIcon,
  StarIcon,
  TrashIcon,
} from "@/components/icons";
import { api } from "../../api.js";
import { InlineError, PageLoading } from "../../components/async-state.js";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "../../components/ui/collapsible.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../../components/ui/dropdown-menu.js";
import { InputGroup, InputGroupAddon, InputGroupInput } from "../../components/ui/input-group.js";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "../../components/ui/sidebar.js";
import {
  WorkspaceSecondaryAppBar,
  WorkspaceSecondaryAppBarActions,
} from "../../components/workspace-secondary-app-bar.js";
import { WorkspaceSkeleton } from "../../components/workspace-skeleton.js";
import { formatRelativeTime } from "../../lib/time-format.js";
import { ConnectionRecoveryAlert, visibleConnectorRefreshInterval } from "../connections/health.js";

type MailboxSection = "categories" | "labels" | "more" | "primary";
export const mailListScopes = ["all", "unread", "starred", "snoozed"] as const;
export type MailListScope = (typeof mailListScopes)[number];

export function isMailListScope(value: string): value is MailListScope {
  return mailListScopes.some((scope) => scope === value);
}

export function mailListScopeFromSearch(params: URLSearchParams): MailListScope {
  const view = params.get("view");
  if (view === "starred" || view === "snoozed") return view;
  return params.get("unread") === "1" ? "unread" : "all";
}

export function mailListScopeParams(scope: MailListScope) {
  if (scope === "unread") return { unread: "1", view: null };
  if (scope === "starred") return { unread: null, view: "starred" };
  if (scope === "snoozed") return { unread: null, view: "snoozed" };
  return { unread: null, view: null };
}

function mailListScopeQuery(scope: MailListScope) {
  if (scope === "unread") return { unread: true };
  if (scope === "starred") return { starred: true };
  if (scope === "snoozed") return { snoozed: true };
  return {};
}

const googleMailboxNames: Record<string, string> = {
  ALL: "All mail",
  CATEGORY_FORUMS: "Forums",
  CATEGORY_PERSONAL: "Primary",
  CATEGORY_PROMOTIONS: "Promotions",
  CATEGORY_SOCIAL: "Social",
  CATEGORY_UPDATES: "Updates",
  CHAT: "Chats",
  DRAFT: "Drafts",
  IMPORTANT: "Important",
  INBOX: "Inbox",
  SENT: "Sent",
  SPAM: "Spam",
  STARRED: "Starred",
  TRASH: "Trash",
  UNREAD: "Unread",
  YELLOW_STAR: "Yellow star",
};

function mailboxToken(mailbox: Mailbox) {
  return mailbox.name.trim().replaceAll(" ", "_").toUpperCase();
}
function mailboxDisplayName(mailbox: Mailbox) {
  const token = mailboxToken(mailbox);
  if (mailbox.provider === "google" && googleMailboxNames[token]) return googleMailboxNames[token];
  const roles: Partial<Record<Mailbox["role"], string>> = {
    archive: "Archive",
    drafts: "Drafts",
    inbox: "Inbox",
    sent: "Sent",
    spam: "Spam",
    trash: "Trash",
  };
  return (
    roles[mailbox.role] ??
    mailbox.name.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase())
  );
}
function mailboxSection(mailbox: Mailbox): MailboxSection {
  const token = mailboxToken(mailbox);
  if (token.startsWith("CATEGORY_")) return "categories";
  if (["spam", "trash"].includes(mailbox.role) || ["CHAT", "UNREAD", "YELLOW_STAR"].includes(token))
    return "more";
  if (
    ["inbox", "sent", "drafts", "archive"].includes(mailbox.role) ||
    ["IMPORTANT", "STARRED"].includes(token)
  )
    return "primary";
  return "labels";
}
function sortMailboxes(items: Mailbox[]) {
  const order = [
    "INBOX",
    "CATEGORY_PERSONAL",
    "STARRED",
    "IMPORTANT",
    "SENT",
    "DRAFT",
    "ALL",
    "CATEGORY_SOCIAL",
    "CATEGORY_PROMOTIONS",
    "CATEGORY_UPDATES",
    "CATEGORY_FORUMS",
    "SPAM",
    "TRASH",
  ];
  return items.toSorted(
    (left, right) =>
      (order.indexOf(mailboxToken(left)) + 1 || order.length + 1) -
        (order.indexOf(mailboxToken(right)) + 1 || order.length + 1) ||
      mailboxDisplayName(left).localeCompare(mailboxDisplayName(right)),
  );
}
function inboxUnreadCount(items: Mailbox[]) {
  return items
    .filter((mailbox) => mailbox.role === "inbox")
    .reduce((sum, mailbox) => sum + mailbox.unreadCount, 0);
}
export const relative = formatRelativeTime;
function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

export function MailTopbarSearch() {
  const [params, setParams] = useSearchParams();
  const search = params.get("q")?.trim() ?? "";
  const [searchDraft, setSearchDraft] = useState(search);

  useEffect(() => setSearchDraft(search), [search]);

  return (
    <form
      className="mail-topbar__search"
      onSubmit={(event) => {
        event.preventDefault();
        setParams((current) => {
          const next = new URLSearchParams(current);
          const query = searchDraft.trim();
          if (query) next.set("q", query);
          else next.delete("q");
          next.delete("thread");
          return next;
        });
      }}
    >
      <InputGroup>
        <InputGroupAddon>
          <SearchIcon aria-hidden="true" />
        </InputGroupAddon>
        <InputGroupInput
          aria-label="Search mail"
          onChange={(event) => setSearchDraft(event.currentTarget.value)}
          placeholder="Search mail"
          type="search"
          value={searchDraft}
        />
      </InputGroup>
    </form>
  );
}

function mailDate(value: string, timeZone: string) {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  }).format(new Date(value));
}

function downloadLegacyMailDraft(draft: LegacyMailDraft) {
  const blob = new Blob([JSON.stringify(draft, null, 2)], { type: "application/json" });
  const href = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const filename = (draft.subject || "historical-draft")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
  link.href = href;
  link.download = `ilo-mail-draft-${filename || "historical-draft"}.json`;
  link.click();
  URL.revokeObjectURL(href);
}

function HistoricalMailDrafts({
  accounts,
  drafts,
  error,
  isPending,
  mutationError,
  mutationPending,
  remove,
}: {
  accounts: CalendarAccount[];
  drafts: LegacyMailDraft[];
  error: Error | null;
  isPending: boolean;
  mutationError: Error | null;
  mutationPending: boolean;
  remove: (id: string) => void;
}) {
  const [pendingDelete, setPendingDelete] = useState<LegacyMailDraft | null>(null);
  if (isPending) return null;
  if (error) return <InlineError error={error} />;
  if (drafts.length === 0) return null;
  return (
    <>
      <Collapsible className="mail-legacy-drafts" defaultOpen>
        <CollapsibleTrigger asChild>
          <Button tone="ghost" type="button">
            <ChevronDownIcon aria-hidden="true" data-icon="inline-start" />
            Historical drafts ({drafts.length})
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="mail-legacy-drafts__content">
          <p>
            Ilo never sends email. These historical records can only be exported to this device or
            permanently deleted.
          </p>
          <div className="mail-legacy-drafts__items">
            {drafts.map((draft) => (
              <article className="mail-legacy-drafts__item" key={draft.id}>
                <div>
                  <strong>{draft.subject || "(No subject)"}</strong>
                  <span>{accounts.find((account) => account.id === draft.accountId)?.label}</span>
                  <span>To: {draft.to.join(", ") || "No recipients"}</span>
                  <span>Updated {mailDate(draft.updatedAt, "UTC")}</span>
                  <Badge>{draft.deliveryState.replaceAll("_", " ")}</Badge>
                </div>
                <div className="mail-legacy-drafts__actions">
                  <Button
                    aria-label={`Export historical draft: ${draft.subject || "No subject"}`}
                    onClick={() => downloadLegacyMailDraft(draft)}
                    tone="ghost"
                    type="button"
                  >
                    <DownloadIcon aria-hidden="true" data-icon="inline-start" />
                    Export
                  </Button>
                  <Button
                    aria-label={`Delete historical draft: ${draft.subject || "No subject"}`}
                    disabled={mutationPending}
                    onClick={() => setPendingDelete(draft)}
                    tone="ghost"
                    type="button"
                  >
                    <TrashIcon aria-hidden="true" data-icon="inline-start" />
                    Delete
                  </Button>
                </div>
              </article>
            ))}
          </div>
          {mutationError ? <InlineError error={mutationError} /> : null}
        </CollapsibleContent>
      </Collapsible>
      <Dialog
        onOpenChange={(open) => (open ? undefined : setPendingDelete(null))}
        open={Boolean(pendingDelete)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete historical draft?</DialogTitle>
            <DialogDescription>
              This permanently removes the draft from Ilo. Export it first if you need a copy.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => setPendingDelete(null)} tone="ghost" type="button">
              Cancel
            </Button>
            <Button
              disabled={mutationPending}
              onClick={() => {
                if (pendingDelete) remove(pendingDelete.id);
                setPendingDelete(null);
              }}
              type="button"
            >
              {mutationPending ? "Deleting…" : "Delete historical draft"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function MailSidebar({ onNavigate }: { onNavigate: () => void }) {
  const [params, setParams] = useSearchParams();
  const accounts = useQuery({
    queryFn: api.listConnectors,
    queryKey: ["connectors"],
    refetchInterval: visibleConnectorRefreshInterval,
  });
  const mailboxes = useQuery({
    queryFn: api.listMailboxes,
    queryKey: ["mailboxes"],
    refetchInterval: 60_000,
  });
  const accountId = params.get("account");
  const mailboxId = params.get("mailbox");
  const enabled = useMemo(
    () => accounts.data?.filter((account) => account.mailEnabled) ?? [],
    [accounts.data],
  );
  const selectedMailbox = mailboxes.data?.find((mailbox) => mailbox.id === mailboxId);
  const activeAccountId = selectedMailbox?.accountId ?? accountId;
  const totalInboxUnread = inboxUnreadCount(mailboxes.data ?? []);
  const [expanded, setExpanded] = useState<string[]>([]);
  const [unifiedExpanded, setUnifiedExpanded] = useState(true);
  const listScope = mailListScopeFromSearch(params);
  useEffect(() => {
    const first = activeAccountId ?? enabled[0]?.id;
    if (first) setExpanded((current) => (current.includes(first) ? current : [...current, first]));
  }, [activeAccountId, enabled]);
  const select = (updates: Record<string, string | null>) => {
    setParams((current) => {
      const next = new URLSearchParams(current);
      for (const [key, value] of Object.entries({
        account: null,
        mailbox: null,
        thread: null,
        ...updates,
      }))
        value ? next.set(key, value) : next.delete(key);
      return next;
    });
    onNavigate();
  };
  return (
    <SidebarGroup className="context-sidebar__mailboxes">
      <SidebarGroupLabel>Mailboxes</SidebarGroupLabel>
      <SidebarGroupContent>
        <nav aria-label="Mailboxes">
          {accounts.isPending || mailboxes.isPending ? (
            <p className="context-sidebar__empty">Loading mailboxes…</p>
          ) : accounts.isError || mailboxes.isError ? (
            <InlineError error={accounts.isError ? accounts.error : mailboxes.error} />
          ) : enabled.length === 0 ? (
            <p className="context-sidebar__empty">Connect a mailbox in Settings to see it here.</p>
          ) : (
            <SidebarMenu className="mail-sidebar__menu">
              <UnifiedInboxNavigation
                expanded={unifiedExpanded}
                listScope={listScope}
                selectScope={(scope) => select(mailListScopeParams(scope))}
                toggle={() => setUnifiedExpanded((current) => !current)}
                unreadCount={totalInboxUnread}
              />
              {enabled.map((account) => (
                <MailboxAccount
                  account={account}
                  activeAccountId={activeAccountId}
                  activeMailboxId={mailboxId}
                  expanded={expanded.includes(account.id)}
                  key={account.id}
                  mailboxes={mailboxes.data.filter((mailbox) => mailbox.accountId === account.id)}
                  selectAccount={() => select({ account: account.id })}
                  selectMailbox={(id) => select({ mailbox: id })}
                  toggle={() =>
                    setExpanded((current) =>
                      current.includes(account.id)
                        ? current.filter((id) => id !== account.id)
                        : [...current, account.id],
                    )
                  }
                />
              ))}
            </SidebarMenu>
          )}
        </nav>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

/* v8 ignore start -- asynchronous view-state variants are covered by browser acceptance tests */
export function MailPage({ user }: { user: User }) {
  const client = useQueryClient();
  const [params, setParams] = useSearchParams();
  const accounts = useQuery({
    queryFn: api.listConnectors,
    queryKey: ["connectors"],
    refetchInterval: visibleConnectorRefreshInterval,
  });
  const mailboxes = useQuery({
    queryFn: api.listMailboxes,
    queryKey: ["mailboxes"],
    refetchInterval: 60_000,
  });
  const mailboxId = params.get("mailbox");
  const accountId = params.get("account");
  const selectedId = params.get("thread");
  const search = params.get("q")?.trim() ?? "";
  const listScope = mailListScopeFromSearch(params);
  const enabled = useMemo(
    () => accounts.data?.filter((account) => account.mailEnabled) ?? [],
    [accounts.data],
  );
  const update = (updates: Record<string, string | null>) =>
    setParams((current) => {
      const next = new URLSearchParams(current);
      for (const [key, value] of Object.entries(updates))
        value ? next.set(key, value) : next.delete(key);
      return next;
    });
  const threads = useQuery({
    queryFn: () =>
      api.listMailThreads({
        ...(accountId && !mailboxId ? { accountIds: [accountId] } : {}),
        ...(mailboxId ? { mailboxId } : {}),
        ...(search ? { query: search } : {}),
        ...mailListScopeQuery(listScope),
      }),
    queryKey: ["mail-threads", accountId, mailboxId, search, listScope],
    refetchInterval: 60_000,
  });
  const legacyDrafts = useQuery({
    queryFn: api.listLegacyMailDrafts,
    queryKey: ["mail-legacy-drafts"],
  });
  const listed = threads.data?.find((thread) => thread.id === selectedId);
  const loaded = useQuery({
    enabled: Boolean(selectedId && threads.data && !listed),
    queryFn: () => api.getMailThread(selectedId as string),
    queryKey: ["mail-thread", selectedId],
  });
  const selected = listed ?? loaded.data;
  const messages = useQuery({
    enabled: Boolean(selected),
    queryFn: () => api.listMailMessages(selected?.id as string),
    queryKey: ["mail-messages", selected?.id],
  });
  const updateThread = useMutation({
    mutationFn: ({
      id,
      ...input
    }: {
      id: string;
      mailboxIds?: string[];
      starred?: boolean;
      unread?: boolean;
    }) => api.updateMailThread(id, input),
    onSuccess: () => client.invalidateQueries({ queryKey: ["mail-threads"] }),
  });
  const snoozeThread = useMutation({
    mutationFn: (id: string) =>
      api.snoozeMailThread(id, new Date(Date.now() + 24 * 60 * 60 * 1_000).toISOString()),
    onSuccess: () => client.invalidateQueries({ queryKey: ["mail-threads"] }),
  });
  const deleteLegacyDraft = useMutation({
    mutationFn: (id: string) => api.deleteLegacyMailDraft(id),
    onSuccess: () => client.invalidateQueries({ queryKey: ["mail-legacy-drafts"] }),
  });
  const historicalDrafts = (
    <HistoricalMailDrafts
      accounts={enabled}
      drafts={legacyDrafts.data ?? []}
      error={legacyDrafts.error}
      isPending={legacyDrafts.isPending}
      mutationError={deleteLegacyDraft.error}
      mutationPending={deleteLegacyDraft.isPending}
      remove={(id) => deleteLegacyDraft.mutate(id)}
    />
  );
  if (accounts.isPending || mailboxes.isPending) return <WorkspaceSkeleton kind="mail" />;
  if (accounts.isError) return <InlineError error={accounts.error} />;
  if (mailboxes.isError) return <InlineError error={mailboxes.error} />;
  if (!enabled.length)
    return (
      <div className="mail-page">
        {historicalDrafts}
        <ConnectionRecoveryAlert accounts={enabled} />
        <div className="narrow-page">
          <p className="eyebrow">Mail for people and agents</p>
          <h1>Inbox</h1>
          <EmptyState icon={<InboxIcon />} title="Connect a mailbox">
            Enable Mail on a connected Google account or add iCloud from Settings.
          </EmptyState>
        </div>
      </div>
    );
  if (threads.isPending) return <WorkspaceSkeleton kind="mail" />;
  return (
    <div className="mail-page">
      {historicalDrafts}
      <ConnectionRecoveryAlert accounts={enabled} />
      {selected ? (
        <MailSecondaryNavigation
          archive={() =>
            updateThread.mutate({
              id: selected.id,
              mailboxIds: selected.mailboxIds.filter(
                (id) => mailboxes.data.find((mailbox) => mailbox.id === id)?.role !== "inbox",
              ),
            })
          }
          pending={updateThread.isPending}
          selected={selected}
          snooze={() => snoozeThread.mutate(selected.id)}
          toggleStar={() => updateThread.mutate({ id: selected.id, starred: !selected.starred })}
          toggleUnread={() => updateThread.mutate({ id: selected.id, unread: !selected.unread })}
          trash={() => {
            const trash = mailboxes.data.find(
              (mailbox) => mailbox.accountId === selected.accountId && mailbox.role === "trash",
            );
            if (trash) updateThread.mutate({ id: selected.id, mailboxIds: [trash.id] });
          }}
        />
      ) : null}
      <div className={`mail-workspace mail-workspace--${selectedId ? "reader" : "list"}`}>
        <section aria-label="Conversations" className="mail-thread-list">
          {threads.isError ? (
            <InlineError error={threads.error} />
          ) : threads.data.length === 0 ? (
            <EmptyState icon={<MailIcon />} title="Nothing here">
              Try another mailbox or a broader search.
            </EmptyState>
          ) : (
            <>
              <div className="mail-thread-list__summary">
                <span>{threads.data.length} conversations</span>
                {listScope === "all" ? null : <Badge>{listScope}</Badge>}
              </div>
              {threads.data.map((thread) => (
                <ThreadRow
                  active={selected?.id === thread.id}
                  key={thread.id}
                  select={() => update({ thread: thread.id })}
                  thread={thread}
                />
              ))}
            </>
          )}
        </section>
        <section aria-label="Message reader" className="mail-reader">
          {selected ? (
            <Reader
              messages={messages.data ?? []}
              thread={selected}
              timeZone={user.planningTimezone}
            />
          ) : selectedId && loaded.isPending ? (
            <PageLoading />
          ) : (
            <EmptyState icon={<MailIcon />} title="Select a conversation">
              Open a conversation to read every synced message and manage it.
            </EmptyState>
          )}
        </section>
      </div>
    </div>
  );
}

function MailSecondaryNavigation({
  archive,
  pending,
  selected,
  snooze,
  toggleStar,
  toggleUnread,
  trash,
}: {
  archive: () => void;
  pending: boolean;
  selected: MailThread;
  snooze: () => void;
  toggleStar: () => void;
  toggleUnread: () => void;
  trash: () => void;
}) {
  return (
    <WorkspaceSecondaryAppBar aria-label="Conversation actions" className="mail-secondary-nav">
      <WorkspaceSecondaryAppBarActions className="mail-secondary-nav__actions">
        <Button aria-label="Archive conversation" disabled={pending} onClick={archive} tone="ghost">
          <ArchiveIcon aria-hidden="true" className="size-4" />
          <span>Archive</span>
        </Button>
        <Button
          aria-label="Snooze conversation until tomorrow"
          className="mail-secondary-nav__compact-action"
          onClick={snooze}
          tone="ghost"
        >
          <ClockIcon aria-hidden="true" className="size-4" />
        </Button>
        <Button
          aria-label={selected.starred ? "Unstar conversation" : "Star conversation"}
          className="mail-secondary-nav__compact-action"
          disabled={pending}
          onClick={toggleStar}
          tone="ghost"
        >
          <StarIcon
            aria-hidden="true"
            className="size-4"
            weight={selected.starred ? "Filled" : "Outline"}
          />
        </Button>
        <Button
          aria-label={selected.unread ? "Mark conversation read" : "Mark conversation unread"}
          className="mail-secondary-nav__compact-action"
          disabled={pending}
          onClick={toggleUnread}
          tone="ghost"
        >
          {selected.unread ? (
            <EyeIcon aria-hidden="true" className="size-4" />
          ) : (
            <EyeOffIcon aria-hidden="true" className="size-4" />
          )}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button aria-label="More conversation actions" disabled={pending} tone="ghost">
              <MoreHorizontalIcon aria-hidden="true" className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem className="mail-secondary-nav__overflow-action" onSelect={snooze}>
              <ClockIcon aria-hidden="true" />
              Snooze until tomorrow
            </DropdownMenuItem>
            <DropdownMenuItem className="mail-secondary-nav__overflow-action" onSelect={toggleStar}>
              <StarIcon aria-hidden="true" weight={selected.starred ? "Filled" : "Outline"} />
              {selected.starred ? "Unstar" : "Star"}
            </DropdownMenuItem>
            <DropdownMenuItem
              className="mail-secondary-nav__overflow-action"
              onSelect={toggleUnread}
            >
              {selected.unread ? <EyeIcon aria-hidden="true" /> : <EyeOffIcon aria-hidden="true" />}
              {selected.unread ? "Mark read" : "Mark unread"}
            </DropdownMenuItem>
            <DropdownMenuSeparator className="mail-secondary-nav__overflow-separator" />
            <DropdownMenuItem onSelect={trash} variant="destructive">
              <TrashIcon aria-hidden="true" />
              Delete conversation
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </WorkspaceSecondaryAppBarActions>
    </WorkspaceSecondaryAppBar>
  );
}

function UnifiedInboxNavigation({
  expanded,
  listScope,
  selectScope,
  toggle,
  unreadCount,
}: {
  expanded: boolean;
  listScope: MailListScope;
  selectScope: (scope: MailListScope) => void;
  toggle: () => void;
  unreadCount: number;
}) {
  const panelId = "unified-mailbox-navigation";
  const scopes: Array<{ icon: typeof MailIcon; label: string; value: MailListScope }> = [
    { icon: MailIcon, label: "All mail", value: "all" },
    { icon: EyeIcon, label: "Unread", value: "unread" },
    { icon: StarIcon, label: "Starred", value: "starred" },
    { icon: ClockIcon, label: "Snoozed", value: "snoozed" },
  ];

  return (
    <Collapsible asChild onOpenChange={toggle} open={expanded}>
      <SidebarMenuItem className="mail-sidebar__account mail-sidebar__unified">
        <CollapsibleTrigger asChild>
          <SidebarMenuButton
            aria-controls={panelId}
            aria-label="Toggle Unified inbox mailboxes"
            className="mail-sidebar__account-trigger"
            size="lg"
          >
            <span className="mail-sidebar__unified-icon">
              <InboxIcon aria-hidden="true" />
            </span>
            <span className="mail-sidebar__account-copy">
              <span className="mail-sidebar__account-name">Unified inbox</span>
              <span className="mail-sidebar__account-email">All connected mail</span>
            </span>
            {unreadCount > 0 ? (
              <span className="mail-sidebar__account-count">{unreadCount}</span>
            ) : null}
            <ChevronDownIcon aria-hidden="true" className="mail-sidebar__chevron" />
          </SidebarMenuButton>
        </CollapsibleTrigger>
        <CollapsibleContent id={panelId}>
          <SidebarMenuSub className="mail-sidebar__account-body">
            {scopes.map(({ icon: Icon, label, value }) => (
              <SidebarMenuSubItem key={value}>
                <SidebarMenuSubButton asChild isActive={listScope === value}>
                  <button
                    aria-pressed={listScope === value}
                    className="mail-sidebar__mailbox-link"
                    onClick={() => selectScope(value)}
                    type="button"
                  >
                    <Icon aria-hidden="true" />
                    <span>{label}</span>
                  </button>
                </SidebarMenuSubButton>
              </SidebarMenuSubItem>
            ))}
          </SidebarMenuSub>
        </CollapsibleContent>
      </SidebarMenuItem>
    </Collapsible>
  );
}

/* v8 ignore stop */
function MailboxAccount({
  account,
  activeAccountId,
  activeMailboxId,
  expanded,
  mailboxes,
  selectAccount,
  selectMailbox,
  toggle,
}: {
  account: CalendarAccount;
  activeAccountId: string | null | undefined;
  activeMailboxId: string | null;
  expanded: boolean;
  mailboxes: Mailbox[];
  selectAccount: () => void;
  selectMailbox: (id: string) => void;
  toggle: () => void;
}) {
  const grouped = Map.groupBy(sortMailboxes(mailboxes), mailboxSection);
  const label = account.label || account.email || "Connected account";
  const panelId = `mailbox-account-${account.id}`;
  const unreadCount = inboxUnreadCount(mailboxes);
  const links = (section: MailboxSection) =>
    (grouped.get(section) ?? []).map((mailbox) => (
      <SidebarMenuSubItem key={mailbox.id}>
        <SidebarMenuSubButton asChild isActive={mailbox.id === activeMailboxId}>
          <button
            aria-pressed={mailbox.id === activeMailboxId}
            className="mail-sidebar__mailbox-link"
            onClick={() => selectMailbox(mailbox.id)}
            type="button"
          >
            <span>{mailboxDisplayName(mailbox)}</span>
            {mailbox.unreadCount > 0 ? <b>{mailbox.unreadCount}</b> : null}
          </button>
        </SidebarMenuSubButton>
      </SidebarMenuSubItem>
    ));
  return (
    <Collapsible asChild onOpenChange={toggle} open={expanded}>
      <SidebarMenuItem className="mail-sidebar__account">
        <CollapsibleTrigger asChild>
          <SidebarMenuButton
            aria-controls={panelId}
            aria-label={`Toggle ${label} ${account.provider === "google" ? "Google Mail" : "iCloud Mail"} mailboxes`}
            className="mail-sidebar__account-trigger"
            size="lg"
          >
            <span className={`provider-icon provider-icon--${account.provider}`}>
              {account.provider === "google" ? "G" : "i"}
            </span>
            <span className="mail-sidebar__account-copy">
              <span className="mail-sidebar__account-name">{label}</span>
              <span className="mail-sidebar__account-email">
                {account.provider === "google" ? "Google Mail" : "iCloud Mail"}
              </span>
            </span>
            {unreadCount > 0 ? (
              <span className="mail-sidebar__account-count">{unreadCount}</span>
            ) : null}
            <ChevronDownIcon aria-hidden="true" className="mail-sidebar__chevron" />
          </SidebarMenuButton>
        </CollapsibleTrigger>
        <CollapsibleContent id={panelId}>
          <SidebarMenuSub className="mail-sidebar__account-body">
            <SidebarMenuSubItem>
              <SidebarMenuSubButton
                asChild
                isActive={activeAccountId === account.id && !activeMailboxId}
              >
                <button
                  aria-pressed={activeAccountId === account.id && !activeMailboxId}
                  className="mail-sidebar__mailbox-link"
                  onClick={selectAccount}
                  type="button"
                >
                  <span>All mail</span>
                </button>
              </SidebarMenuSubButton>
            </SidebarMenuSubItem>
            {links("primary")}
            {(grouped.get("categories")?.length ?? 0) > 0 ? (
              <>
                <SidebarMenuSubItem aria-hidden="true" className="mail-sidebar__subgroup-label">
                  Categories
                </SidebarMenuSubItem>
                {links("categories")}
              </>
            ) : null}
            {(["labels", "more"] as const).map((section) =>
              (grouped.get(section)?.length ?? 0) > 0 ? (
                <Collapsible
                  asChild
                  defaultOpen={
                    grouped.get(section)?.some((mailbox) => mailbox.id === activeMailboxId) ?? false
                  }
                  key={section}
                >
                  <SidebarMenuSubItem className="mail-sidebar__subgroup">
                    <CollapsibleTrigger asChild>
                      <SidebarMenuSubButton asChild>
                        <button className="mail-sidebar__subgroup-trigger" type="button">
                          <ChevronDownIcon aria-hidden="true" />
                          <span>{section === "labels" ? "Labels" : "More"}</span>
                          <small>{grouped.get(section)?.length}</small>
                        </button>
                      </SidebarMenuSubButton>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <SidebarMenuSub className="mail-sidebar__nested-list">
                        {links(section)}
                      </SidebarMenuSub>
                    </CollapsibleContent>
                  </SidebarMenuSubItem>
                </Collapsible>
              ) : null,
            )}
          </SidebarMenuSub>
        </CollapsibleContent>
      </SidebarMenuItem>
    </Collapsible>
  );
}
function ThreadRow({
  active,
  select,
  thread,
}: {
  active: boolean;
  select: () => void;
  thread: MailThread;
}) {
  return (
    <button
      aria-pressed={active}
      className={`mail-thread-row${active ? " is-active" : ""}${thread.unread ? " is-unread" : ""}`}
      onClick={select}
      type="button"
    >
      <span className="mail-thread-row__sender">
        {thread.from.name || thread.from.address || "Unknown sender"}
      </span>
      <time>{relative(thread.receivedAt)}</time>
      <strong>{thread.subject}</strong>
      <span className="mail-thread-row__snippet">{thread.snippet || "No preview available"}</span>
      <span className="mail-thread-row__meta">
        {thread.starred ? (
          <StarIcon aria-label="Starred" className="size-[13px]" weight="Filled" />
        ) : null}
        {thread.messageCount > 1 ? `${thread.messageCount} messages` : null}
      </span>
    </button>
  );
}
function Reader({
  messages,
  thread,
  timeZone,
}: {
  messages: MailMessage[];
  thread: MailThread;
  timeZone: string;
}) {
  const fallbackMessage: MailMessage = {
    attachments: [],
    bodyText: thread.bodyText,
    cc: [],
    from: thread.from,
    id: thread.id,
    receivedAt: thread.receivedAt,
    threadId: thread.id,
    to: thread.to,
  };
  const displayedMessages = messages.length
    ? messages.some((message) => message.bodyText === thread.bodyText)
      ? messages
      : [fallbackMessage, ...messages]
    : [fallbackMessage];

  return (
    <article className="mail-reader__article">
      <header>
        <p className="eyebrow">{thread.provider === "google" ? "Google Mail" : "iCloud Mail"}</p>
        <h2>{thread.subject}</h2>
        <div className="mail-reader__address">
          <span className="avatar">{initials(thread.from.name || thread.from.address || "?")}</span>
          <div>
            <strong>{thread.from.name || thread.from.address || "Unknown sender"}</strong>
            <small>
              {thread.from.address} · {mailDate(thread.receivedAt, timeZone)}
            </small>
          </div>
        </div>
        <details className="mail-reader__details">
          <summary>Message details</summary>
          <dl>
            <div>
              <dt>From</dt>
              <dd>{thread.from.address || "Unknown sender"}</dd>
            </div>
            <div>
              <dt>To</dt>
              <dd>
                {thread.to
                  .map((recipient) => recipient.address)
                  .filter(Boolean)
                  .join(", ") || "You"}
              </dd>
            </div>
            <div>
              <dt>Received</dt>
              <dd>{mailDate(thread.receivedAt, timeZone)}</dd>
            </div>
          </dl>
        </details>
      </header>
      {displayedMessages.map((message) => (
        <section className="mail-reader__message" key={message.id}>
          <div className="mail-reader__address">
            <span className="avatar">
              {initials(message.from.name || message.from.address || "?")}
            </span>
            <div>
              <strong>{message.from.name || message.from.address || "Unknown sender"}</strong>
              <small>
                {message.from.address} · {mailDate(message.receivedAt, timeZone)}
              </small>
            </div>
          </div>
          <pre>{message.bodyText || "This message has no plain-text body."}</pre>
          {message.attachments.length ? (
            <ul aria-label="Attachments" className="mail-reader__attachments">
              {message.attachments.map((attachment) => (
                <li key={attachment.id}>
                  {attachment.filename} · {attachment.contentType}
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ))}
    </article>
  );
}
