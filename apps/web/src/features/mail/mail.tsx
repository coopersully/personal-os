import type { MailAddress, MailDraft, MailMessage, MailThread, User } from "@personal-os/domain";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  ArchiveIcon,
  ArrowLeftIcon,
  ClockIcon,
  EditIcon,
  EyeIcon,
  EyeOffIcon,
  FileTextIcon,
  ForwardIcon,
  InboxIcon,
  ListChecksIcon,
  MailIcon,
  MoreHorizontalIcon,
  ReplyIcon,
  SearchIcon,
  StarIcon,
  TrashIcon,
} from "@/components/icons";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { api } from "../../api.js";
import { InlineError, PageLoading } from "../../components/async-state.js";
import { Avatar, AvatarFallback } from "../../components/ui/avatar.js";
import { Badge } from "../../components/ui/badge.js";
import { Button } from "../../components/ui/button.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../../components/ui/dropdown-menu.js";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "../../components/ui/empty.js";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "../../components/ui/hover-card.js";
import { InputGroup, InputGroupAddon, InputGroupInput } from "../../components/ui/input-group.js";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "../../components/ui/sidebar.js";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../components/ui/tooltip.js";
import {
  WorkspaceSecondaryAppBar,
  WorkspaceSecondaryAppBarActions,
  WorkspaceSecondaryAppBarLeading,
} from "../../components/workspace-secondary-app-bar.js";
import { WorkspaceSkeleton } from "../../components/workspace-skeleton.js";
import { useErrorNotification } from "../../lib/error-notification.js";
import { formatRelativeTime } from "../../lib/time-format.js";
import { ConnectionRecoveryAlert, visibleConnectorRefreshInterval } from "../connections/health.js";
import { type ComposeIntent, FloatingMailComposer } from "./floating-compose.js";

export const mailListScopes = ["all", "unread", "starred", "snoozed", "sent", "drafts"] as const;
export type MailListScope = (typeof mailListScopes)[number];

export function isMailListScope(value: string): value is MailListScope {
  return mailListScopes.some((scope) => scope === value);
}

export function mailListScopeFromSearch(params: URLSearchParams): MailListScope {
  const view = params.get("view");
  if (view === "starred" || view === "snoozed" || view === "sent" || view === "drafts") return view;
  return params.get("unread") === "1" ? "unread" : "all";
}

export function mailListScopeParams(scope: MailListScope) {
  if (scope === "unread") return { unread: "1", view: null };
  if (scope === "starred") return { unread: null, view: "starred" };
  if (scope === "snoozed") return { unread: null, view: "snoozed" };
  if (scope === "sent") return { unread: null, view: "sent" };
  if (scope === "drafts") return { unread: null, view: "drafts" };
  return { unread: null, view: null };
}

export function mailListScopeQuery(scope: MailListScope) {
  if (scope === "unread") return { unread: true };
  if (scope === "starred") return { starred: true };
  if (scope === "snoozed") return { snoozed: true };
  if (scope === "sent") return { mailboxRole: "sent" as const };
  if (scope === "all") return { mailboxRole: "inbox" as const };
  return {};
}

export function mailReplyRecipient(
  message: MailMessage | undefined,
  accountAddress: string | null | undefined,
  fallback: MailAddress,
): MailAddress | null {
  if (!message) return fallback;
  const ownAddress = accountAddress?.toLowerCase();
  if (message.from.address.toLowerCase() !== ownAddress) {
    return message.replyTo[0] ?? message.from;
  }
  return (
    [...message.to, ...message.cc].find(
      (recipient) => recipient.address.toLowerCase() !== ownAddress,
    ) ?? null
  );
}

function inboxUnreadCount(items: Array<{ role: string; unreadCount: number }>) {
  return items
    .filter((mailbox) => mailbox.role === "inbox")
    .reduce((sum, mailbox) => sum + mailbox.unreadCount, 0);
}
export const relative = formatRelativeTime;
const mailReaderLayoutStorageKey = "ilo.mail.reader-layout.v1";
const mailListDensityStorageKey = "ilo.mail.list-density.v1";
export const mailListDensities = ["compact", "comfortable", "expanded"] as const;
export type MailListDensity = (typeof mailListDensities)[number];

export function storedMailListDensity(): MailListDensity {
  try {
    if (typeof window === "undefined") return "comfortable";
    const value = window.localStorage.getItem(mailListDensityStorageKey);
    return mailListDensities.find((density) => density === value) ?? "comfortable";
  } catch {
    return "comfortable";
  }
}

export function persistMailListDensity(density: MailListDensity) {
  try {
    window.localStorage.setItem(mailListDensityStorageKey, density);
  } catch {
    // A browser storage restriction must not prevent changing list density.
  }
}

export function storedMailReaderLayout() {
  try {
    if (typeof window === "undefined") return undefined;
    const value = JSON.parse(
      window.localStorage.getItem(mailReaderLayoutStorageKey) ?? "null",
    ) as unknown;
    if (
      value &&
      typeof value === "object" &&
      typeof (value as Record<string, unknown>)["mail-list"] === "number" &&
      typeof (value as Record<string, unknown>)["mail-reader"] === "number"
    )
      return value as Record<string, number>;
  } catch {
    // A damaged preference should never prevent Mail from opening.
  }
  return undefined;
}

export function persistMailReaderLayout(layout: Record<string, number>) {
  try {
    window.localStorage.setItem(mailReaderLayoutStorageKey, JSON.stringify(layout));
  } catch {
    // A browser storage restriction must not prevent panel resizing.
  }
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

export function MailTopbarSearch({
  onSearch,
  search,
}: {
  onSearch: (query: string) => void;
  search: string;
}) {
  const [draft, setDraft] = useState(search);
  const pendingSearch = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastCommittedSearch = useRef<string | null>(null);
  const commitSearch = (query: string) => {
    if (pendingSearch.current) clearTimeout(pendingSearch.current);
    pendingSearch.current = null;
    const committed = query.trim();
    lastCommittedSearch.current = committed === search ? null : committed;
    onSearch(committed);
  };
  useEffect(() => {
    if (lastCommittedSearch.current === search) {
      lastCommittedSearch.current = null;
      return;
    }
    lastCommittedSearch.current = null;
    setDraft(search);
  }, [search]);
  useEffect(
    () => () => {
      if (pendingSearch.current) clearTimeout(pendingSearch.current);
    },
    [],
  );

  return (
    <form
      className="mail-topbar__search"
      onSubmit={(event) => {
        event.preventDefault();
        commitSearch(draft);
      }}
    >
      <InputGroup>
        <InputGroupAddon>
          <SearchIcon aria-hidden="true" />
        </InputGroupAddon>
        <InputGroupInput
          aria-label="Search mail"
          name="query"
          onChange={(event) => {
            const query = event.currentTarget.value;
            setDraft(query);
            if (pendingSearch.current) clearTimeout(pendingSearch.current);
            pendingSearch.current = setTimeout(() => commitSearch(query), 250);
          }}
          placeholder="Search mail"
          type="search"
          value={draft}
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

export function MailSidebar({ onNavigate }: { onNavigate: () => void }) {
  const [params] = useSearchParams();
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
  const enabled = useMemo(
    () => accounts.data?.filter((account) => account.mailEnabled) ?? [],
    [accounts.data],
  );
  const totalInboxUnread = inboxUnreadCount(mailboxes.data ?? []);
  const listScope = mailListScopeFromSearch(params);
  const selectedAccountIds = params.getAll("account");
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
              <UnifiedMailDestinations
                listScope={listScope}
                onNavigate={onNavigate}
                selectedAccountIds={selectedAccountIds}
                unreadCount={totalInboxUnread}
              />
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
  const accountIds = params.getAll("account");
  const selectedId = params.get("thread");
  const search = params.get("q")?.trim() ?? "";
  const listScope = mailListScopeFromSearch(params);
  const [composeIntent, setComposeIntent] = useState<ComposeIntent | null>(null);
  const [density, setDensity] = useState<MailListDensity>(storedMailListDensity);
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
    enabled: listScope !== "drafts",
    queryFn: () =>
      api.listMailThreads({
        ...(accountIds.length && !mailboxId ? { accountIds } : {}),
        ...(mailboxId ? { mailboxId } : {}),
        ...(search ? { query: search } : {}),
        ...mailListScopeQuery(listScope),
      }),
    queryKey: ["mail-threads", accountIds, mailboxId, search, listScope],
    refetchInterval: 60_000,
  });
  const setup = useQuery({
    queryFn: api.getMailSetupContext,
    queryKey: ["mail-setup-context"],
    refetchInterval: visibleConnectorRefreshInterval,
  });
  useErrorNotification(!setup.data && setup.isError ? setup.error : null);
  const drafts = useQuery({
    enabled: listScope === "drafts",
    queryFn: api.listMailDrafts,
    queryKey: ["mail-drafts"],
  });
  const deleteDraft = useMutation({
    mutationFn: api.deleteMailDraft,
    onSuccess: () => client.invalidateQueries({ queryKey: ["mail-drafts"] }),
  });
  const reconcileDraft = useMutation({
    mutationFn: ({ id, outcome }: { id: string; outcome: "not_sent" | "sent" }) =>
      api.reconcileMailDraft(id, { outcome }),
    onSuccess: () => client.invalidateQueries({ queryKey: ["mail-drafts"] }),
  });
  const listed = threads.data?.find((thread) => thread.id === selectedId);
  const loaded = useQuery({
    enabled: Boolean(selectedId && threads.data && !listed),
    queryFn: () => api.getMailThread(selectedId as string),
    queryKey: ["mail-thread", selectedId],
  });
  const selected = listed ?? loaded.data;
  const readerLayout = useMemo(storedMailReaderLayout, []);
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
  if (accounts.isPending || mailboxes.isPending) return <WorkspaceSkeleton kind="mail" />;
  if (accounts.isError) return <InlineError error={accounts.error} />;
  if (mailboxes.isError) return <InlineError error={mailboxes.error} />;
  if (!enabled.length)
    return (
      <div className="mail-page">
        <div className="narrow-page">
          <h1>Inbox</h1>
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <InboxIcon aria-hidden="true" />
              </EmptyMedia>
              <EmptyTitle>Connect a mailbox</EmptyTitle>
              <EmptyDescription>
                Enable Mail on a connected Google account or add iCloud from Settings.
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button asChild>
                <Link to="/settings?section=connections">Connect a mailbox</Link>
              </Button>
            </EmptyContent>
          </Empty>
        </div>
      </div>
    );
  if (listScope !== "drafts" && threads.isPending) return <WorkspaceSkeleton kind="mail" />;
  return (
    <>
      <MailSecondaryNavigation
        archive={() => {
          if (!selected) return;
          updateThread.mutate({
            id: selected.id,
            mailboxIds: selected.mailboxIds.filter(
              (id) => mailboxes.data.find((mailbox) => mailbox.id === id)?.role !== "inbox",
            ),
          });
        }}
        back={() => update({ thread: null })}
        countLabel={
          listScope === "drafts"
            ? `${(drafts.data ?? []).filter((draft) => draft.sendStatus !== "sent").length} drafts`
            : `${threads.data?.length ?? 0} conversations`
        }
        density={density}
        forward={() => {
          if (!selected) return;
          setComposeIntent({
            accountId: selected.accountId,
            body: `\n\n---------- Forwarded message ----------\nFrom: ${selected.from.name || selected.from.address} <${selected.from.address}>\nSubject: ${selected.subject}\n\n${selected.bodyText}`,
            subject: selected.subject.startsWith("Fwd:")
              ? selected.subject
              : `Fwd: ${selected.subject}`,
          });
        }}
        listScope={listScope}
        pending={updateThread.isPending}
        reply={() => {
          if (!selected) return;
          const accountAddress = setup.data?.accounts
            .find((account) => account.accountId === selected.accountId)
            ?.email?.toLowerCase();
          const latestMessage = messages.data?.at(-1);
          const replyRecipient = mailReplyRecipient(latestMessage, accountAddress, selected.from);
          if (!replyRecipient) return;
          setComposeIntent({
            accountId: selected.accountId,
            subject: selected.subject.startsWith("Re:")
              ? selected.subject
              : `Re: ${selected.subject}`,
            threadId: selected.id,
            to: replyRecipient.address,
          });
        }}
        selected={selected}
        setDensity={(nextDensity) => {
          setDensity(nextDensity);
          persistMailListDensity(nextDensity);
        }}
        snooze={() => {
          if (selected) snoozeThread.mutate(selected.id);
        }}
        toggleStar={() => {
          if (selected) updateThread.mutate({ id: selected.id, starred: !selected.starred });
        }}
        toggleUnread={() => {
          if (selected) updateThread.mutate({ id: selected.id, unread: !selected.unread });
        }}
        trash={() => {
          if (!selected) return;
          const trash = mailboxes.data.find(
            (mailbox) => mailbox.accountId === selected.accountId && mailbox.role === "trash",
          );
          if (trash) updateThread.mutate({ id: selected.id, mailboxIds: [trash.id] });
        }}
      />
      <div className="mail-page">
        <ResizablePanelGroup
          className={`mail-workspace mail-workspace--${selectedId ? "reader" : "list"}`}
          defaultLayout={readerLayout}
          id="mail-reader-layout"
          onLayoutChanged={(layout, metadata) => {
            if (metadata.isUserInteraction) persistMailReaderLayout(layout);
          }}
          orientation="horizontal"
        >
          <ResizablePanel defaultSize="34%" id="mail-list" minSize="280px">
            <section aria-label="Conversations" className="mail-thread-list">
              <ConnectionRecoveryAlert accounts={enabled} />
              {listScope === "drafts" ? (
                drafts.isPending ? (
                  <PageLoading />
                ) : drafts.isError ? (
                  <InlineError error={drafts.error} />
                ) : (
                  <MailDraftList
                    drafts={(drafts.data ?? []).filter((draft) => draft.sendStatus !== "sent")}
                    openDraft={setComposeIntent}
                    reconcile={(id, outcome) => reconcileDraft.mutate({ id, outcome })}
                    remove={(id) => deleteDraft.mutate(id)}
                  />
                )
              ) : threads.isError ? (
                <InlineError error={threads.error} />
              ) : threads.data?.length === 0 ? (
                <Empty>
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <MailIcon aria-hidden="true" />
                    </EmptyMedia>
                    <EmptyTitle>Nothing here</EmptyTitle>
                    <EmptyDescription>Try another mailbox or a broader search.</EmptyDescription>
                  </EmptyHeader>
                </Empty>
              ) : (
                threads.data?.map((thread) => (
                  <ThreadRow
                    active={selected?.id === thread.id}
                    density={density}
                    key={thread.id}
                    select={() => update({ thread: thread.id })}
                    thread={thread}
                  />
                ))
              )}
            </section>
          </ResizablePanel>
          <ResizableHandle aria-label="Resize conversation list" withHandle />
          <ResizablePanel defaultSize="66%" id="mail-reader" minSize="360px">
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
                <Empty className="mail-reader__empty">
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <MailIcon aria-hidden="true" />
                    </EmptyMedia>
                    <EmptyTitle>Select a conversation</EmptyTitle>
                    <EmptyDescription>
                      Open a conversation to read every synced message and manage it.
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              )}
            </section>
          </ResizablePanel>
        </ResizablePanelGroup>
        <FloatingMailComposer
          accounts={setup.data?.accounts ?? []}
          accountsState={setup.data ? "ready" : setup.isError ? "error" : "loading"}
          intent={composeIntent}
          onIntentHandled={() => setComposeIntent(null)}
          onRetryAccounts={() => void setup.refetch()}
        />
      </div>
    </>
  );
}

function MailDraftList({
  drafts,
  openDraft,
  reconcile,
  remove,
}: {
  drafts: MailDraft[];
  openDraft: (intent: ComposeIntent) => void;
  reconcile: (id: string, outcome: "not_sent" | "sent") => void;
  remove: (id: string) => void;
}) {
  if (!drafts.length)
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <MailIcon aria-hidden="true" />
          </EmptyMedia>
          <EmptyTitle>No drafts</EmptyTitle>
          <EmptyDescription>Messages you start will be saved here automatically.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  return drafts.map((draft) => (
    <article className="mail-draft-row" key={draft.id}>
      <button className="mail-thread-row" onClick={() => openDraft({ draft })} type="button">
        <span className="mail-thread-row__sender">
          {draft.to.map((recipient) => recipient.address).join(", ") || "No recipients"}
        </span>
        <time>{draft.sendStatus === "reconcile" ? "Needs review" : "Draft"}</time>
        <strong>{draft.subject || "(No subject)"}</strong>
        <span className="mail-thread-row__snippet">{draft.body || "Empty message"}</span>
      </button>
      <div className="mail-draft-row__actions">
        {draft.sendStatus === "reconcile" ? (
          <>
            <Button onClick={() => reconcile(draft.id, "sent")} size="sm" variant="ghost">
              Mark sent
            </Button>
            <Button onClick={() => reconcile(draft.id, "not_sent")} size="sm" variant="ghost">
              Not sent
            </Button>
          </>
        ) : (
          <Button onClick={() => remove(draft.id)} size="sm" variant="ghost">
            Discard
          </Button>
        )}
      </div>
    </article>
  ));
}

function MailSecondaryNavigation({
  archive,
  back,
  countLabel,
  density,
  pending,
  forward,
  listScope,
  reply,
  selected,
  setDensity,
  snooze,
  toggleStar,
  toggleUnread,
  trash,
}: {
  archive: () => void;
  back: () => void;
  countLabel: string;
  density: MailListDensity;
  pending: boolean;
  forward: () => void;
  listScope: MailListScope;
  reply: () => void;
  selected: MailThread | undefined;
  setDensity: (density: MailListDensity) => void;
  snooze: () => void;
  toggleStar: () => void;
  toggleUnread: () => void;
  trash: () => void;
}) {
  return (
    <WorkspaceSecondaryAppBar aria-label="Mail controls" className="mail-secondary-nav">
      <WorkspaceSecondaryAppBarLeading className="mail-secondary-nav__leading">
        <span>{countLabel}</span>
        {listScope === "all" ? null : <Badge>{listScope}</Badge>}
      </WorkspaceSecondaryAppBarLeading>
      <WorkspaceSecondaryAppBarActions className="mail-secondary-nav__actions">
        <div
          aria-hidden={selected ? undefined : "true"}
          className="mail-secondary-nav__conversation-actions"
          data-visible={selected ? "true" : "false"}
        >
          <Button
            aria-label="Back to inbox"
            disabled={!selected}
            onClick={back}
            tabIndex={selected ? undefined : -1}
            type="button"
            variant="ghost"
          >
            <ArrowLeftIcon aria-hidden="true" />
          </Button>
          <Button
            aria-label="Reply"
            disabled={!selected}
            onClick={reply}
            tabIndex={selected ? undefined : -1}
            variant="ghost"
          >
            <ReplyIcon aria-hidden="true" data-icon="inline-start" />
            <span>Reply</span>
          </Button>
          <Button
            aria-label="Forward"
            disabled={!selected}
            onClick={forward}
            tabIndex={selected ? undefined : -1}
            variant="ghost"
          >
            <ForwardIcon aria-hidden="true" data-icon="inline-start" />
            <span>Forward</span>
          </Button>
          <Button
            aria-label="Archive conversation"
            disabled={!selected || pending}
            onClick={archive}
            tabIndex={selected ? undefined : -1}
            variant="ghost"
          >
            <ArchiveIcon aria-hidden="true" data-icon="inline-start" />
            <span>Archive</span>
          </Button>
          <Button
            aria-label="Snooze conversation until tomorrow"
            className="mail-secondary-nav__compact-action"
            disabled={!selected}
            onClick={snooze}
            tabIndex={selected ? undefined : -1}
            variant="ghost"
          >
            <ClockIcon aria-hidden="true" />
          </Button>
          <Button
            aria-label={selected?.starred ? "Unstar conversation" : "Star conversation"}
            className="mail-secondary-nav__compact-action"
            disabled={!selected || pending}
            onClick={toggleStar}
            tabIndex={selected ? undefined : -1}
            variant="ghost"
          >
            <StarIcon aria-hidden="true" weight={selected?.starred ? "Filled" : "Outline"} />
          </Button>
          <Button
            aria-label={selected?.unread ? "Mark conversation read" : "Mark conversation unread"}
            className="mail-secondary-nav__compact-action"
            disabled={!selected || pending}
            onClick={toggleUnread}
            tabIndex={selected ? undefined : -1}
            variant="ghost"
          >
            {selected?.unread ? <EyeIcon aria-hidden="true" /> : <EyeOffIcon aria-hidden="true" />}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                aria-label="More conversation actions"
                disabled={!selected || pending}
                tabIndex={selected ? undefined : -1}
                variant="ghost"
              >
                <MoreHorizontalIcon aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem className="mail-secondary-nav__overflow-action" onSelect={snooze}>
                <ClockIcon aria-hidden="true" />
                Snooze until tomorrow
              </DropdownMenuItem>
              <DropdownMenuItem
                className="mail-secondary-nav__overflow-action"
                onSelect={toggleStar}
              >
                <StarIcon aria-hidden="true" weight={selected?.starred ? "Filled" : "Outline"} />
                {selected?.starred ? "Unstar" : "Star"}
              </DropdownMenuItem>
              <DropdownMenuItem
                className="mail-secondary-nav__overflow-action"
                onSelect={toggleUnread}
              >
                {selected?.unread ? (
                  <EyeIcon aria-hidden="true" />
                ) : (
                  <EyeOffIcon aria-hidden="true" />
                )}
                {selected?.unread ? "Mark read" : "Mark unread"}
              </DropdownMenuItem>
              <DropdownMenuSeparator className="mail-secondary-nav__overflow-separator" />
              <DropdownMenuItem onSelect={trash} variant="destructive">
                <TrashIcon aria-hidden="true" />
                Delete conversation
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <Button
                  aria-label="Message list layout"
                  className="mail-secondary-nav__density"
                  size="icon"
                  variant="ghost"
                >
                  <ListChecksIcon aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent>Message list layout</TooltipContent>
          </Tooltip>
          <DropdownMenuContent align="end" className="mail-density-menu">
            <DropdownMenuLabel>Message list layout</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              onValueChange={(value) => setDensity(value as MailListDensity)}
              value={density}
            >
              {mailListDensities.map((option) => (
                <DropdownMenuRadioItem key={option} value={option}>
                  {option.charAt(0).toUpperCase() + option.slice(1)}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </WorkspaceSecondaryAppBarActions>
    </WorkspaceSecondaryAppBar>
  );
}

function UnifiedMailDestinations({
  listScope,
  onNavigate,
  selectedAccountIds,
  unreadCount,
}: {
  listScope: MailListScope;
  onNavigate: () => void;
  selectedAccountIds: string[];
  unreadCount: number;
}) {
  const scopes: Array<{ icon: typeof MailIcon; label: string; value: MailListScope }> = [
    { icon: InboxIcon, label: "Inbox", value: "all" },
    { icon: EyeIcon, label: "Unread", value: "unread" },
    { icon: StarIcon, label: "Starred", value: "starred" },
    { icon: ClockIcon, label: "Snoozed", value: "snoozed" },
    { icon: ForwardIcon, label: "Sent", value: "sent" },
    { icon: EditIcon, label: "Drafts", value: "drafts" },
  ];

  return (
    <>
      {scopes.map(({ icon: Icon, label, value }) => {
        const query = new URLSearchParams();
        const params = mailListScopeParams(value);
        if (params.unread) query.set("unread", params.unread);
        if (params.view) query.set("view", params.view);
        for (const accountId of selectedAccountIds) query.append("account", accountId);
        const suffix = query.size ? `?${query.toString()}` : "";
        return (
          <SidebarMenuItem key={value}>
            <SidebarMenuButton asChild isActive={listScope === value} tooltip={label}>
              <Link
                aria-label={value === "all" && unreadCount > 0 ? `${label} ${unreadCount}` : label}
                onClick={onNavigate}
                to={`/mail${suffix}`}
              >
                <Icon aria-hidden="true" weight={listScope === value ? "Filled" : "Outline"} />
                <span>{label}</span>
                {value === "all" && unreadCount > 0 ? <b>{unreadCount}</b> : null}
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        );
      })}
    </>
  );
}
/* v8 ignore stop */
function ThreadRow({
  active,
  density,
  select,
  thread,
}: {
  active: boolean;
  density: MailListDensity;
  select: () => void;
  thread: MailThread;
}) {
  return (
    <button
      aria-label={`${thread.from.name || thread.from.address || "Unknown sender"}: ${thread.subject}`}
      aria-current={active ? "true" : undefined}
      className={`mail-thread-row${active ? " is-active" : ""}${thread.unread ? " is-unread" : ""}`}
      data-density={density}
      onClick={select}
      type="button"
    >
      <span className="mail-thread-row__sender">
        <Avatar className="mail-thread-row__avatar" size="sm">
          <AvatarFallback>
            {initials(thread.from.name || thread.from.address || "?")}
          </AvatarFallback>
        </Avatar>
        <span>{thread.from.name || thread.from.address || "Unknown sender"}</span>
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
  const [collapsedMessageIds, setCollapsedMessageIds] = useState<Set<string>>(() => new Set());
  const fallbackMessage: MailMessage = {
    attachments: [],
    bodyText: thread.bodyText,
    cc: [],
    from: thread.from,
    id: thread.id,
    messageId: null,
    receivedAt: thread.receivedAt,
    references: [],
    replyTo: [],
    threadId: thread.id,
    to: thread.to,
  };
  const displayedMessages = messages.length
    ? messages.some((message) => message.bodyText === thread.bodyText)
      ? messages
      : [fallbackMessage, ...messages]
    : [fallbackMessage];

  function toggleMessage(messageId: string) {
    setCollapsedMessageIds((current) => {
      const next = new Set(current);
      if (next.has(messageId)) next.delete(messageId);
      else next.add(messageId);
      return next;
    });
  }

  return (
    <article className="mail-reader__article">
      <header className="mail-reader__subject">
        <h2>{thread.subject}</h2>
      </header>
      {displayedMessages.map((message) => {
        const collapsed = collapsedMessageIds.has(message.id);
        const senderName = message.from.name || message.from.address || "Unknown sender";
        return (
          <section className="mail-reader__message" data-collapsed={collapsed} key={message.id}>
            <header className="mail-reader__message-header">
              <button
                aria-expanded={!collapsed}
                aria-label={`${collapsed ? "Expand" : "Collapse"} message from ${senderName}`}
                className="mail-reader__message-toggle"
                onClick={() => toggleMessage(message.id)}
                type="button"
              />
              <Avatar className="mail-reader__sender-avatar">
                <AvatarFallback>
                  {initials(message.from.name || message.from.address || "?")}
                </AvatarFallback>
              </Avatar>
              <div className="mail-reader__message-meta">
                <div className="mail-reader__sender-line">
                  <strong>
                    <MailContactHoverCard address={message.from} />
                  </strong>
                  <time dateTime={message.receivedAt}>
                    {mailDate(message.receivedAt, timeZone)}
                  </time>
                </div>
                <div className="mail-reader__recipients">
                  <span>to</span>
                  {message.to.length ? (
                    message.to.map((recipient, index) => (
                      <span key={`to-${recipient.address}-${recipient.name}`}>
                        {index ? ", " : null}
                        <MailContactHoverCard address={recipient} />
                      </span>
                    ))
                  ) : (
                    <span>undisclosed recipients</span>
                  )}
                  {message.cc.length ? <span className="mail-reader__cc">cc</span> : null}
                  {message.cc.map((recipient, index) => (
                    <span key={`cc-${recipient.address}-${recipient.name}`}>
                      {index ? ", " : null}
                      <MailContactHoverCard address={recipient} />
                    </span>
                  ))}
                </div>
              </div>
            </header>
            {!collapsed ? (
              <div className="mail-reader__message-content">
                <pre>{message.bodyText || "This message has no plain-text body."}</pre>
                {message.attachments.length ? (
                  <ul aria-label="Attachments" className="mail-reader__attachments">
                    {message.attachments.map((attachment) => (
                      <li key={attachment.id}>
                        <FileTextIcon aria-hidden="true" />
                        <span>
                          <strong>{attachment.filename || "Attachment"}</strong>
                          <small>
                            {attachment.contentType}
                            {attachment.size ? ` · ${formatAttachmentSize(attachment.size)}` : ""}
                          </small>
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}
          </section>
        );
      })}
    </article>
  );
}

function MailContactHoverCard({ address }: { address: MailAddress }) {
  const label = address.name || address.address || "Unknown contact";
  return (
    <HoverCard>
      <HoverCardTrigger asChild>
        <button
          aria-label={`Contact details for ${label}`}
          className="mail-reader__contact-trigger"
          type="button"
        >
          {label}
        </button>
      </HoverCardTrigger>
      <HoverCardContent align="start">
        <div className="mail-reader__contact-card">
          <Avatar>
            <AvatarFallback>{initials(label)}</AvatarFallback>
          </Avatar>
          <div>
            <strong>{label}</strong>
            <span>{address.address || "No email address available"}</span>
          </div>
        </div>
      </HoverCardContent>
    </HoverCard>
  );
}

function formatAttachmentSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
