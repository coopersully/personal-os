import type { CalendarAccount } from "@personal-os/api-client";
import type { Mailbox, MailDraft, MailMessage, MailThread, User } from "@personal-os/domain";
import { Badge, Button, EmptyState } from "@personal-os/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  ChevronDown,
  ChevronLeft,
  Clock3,
  Eye,
  EyeOff,
  Inbox,
  Mail,
  Reply,
  Star,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../../api.js";
import { InlineError, PageLoading } from "../../components/async-state.js";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "../../components/ui/collapsible.js";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "../../components/ui/sidebar.js";
import { WorkspaceSkeleton } from "../../components/workspace-skeleton.js";
import { formatRelativeTime } from "../../lib/time-format.js";

type MailboxSection = "categories" | "labels" | "more" | "primary";
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
function mailDate(value: string, timeZone: string) {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  }).format(new Date(value));
}

function MailSendRecovery({
  drafts,
  error,
  isPending,
  mutationError,
  mutationPending,
  reconcile,
}: {
  drafts: MailDraft[];
  error: Error | null;
  isPending: boolean;
  mutationError: Error | null;
  mutationPending: boolean;
  reconcile: (id: string, outcome: "not_sent" | "sent") => void;
}) {
  if (isPending)
    return (
      <p aria-live="polite" className="mail-send-recovery__loading">
        Checking uncertain sends…
      </p>
    );
  if (error) return <InlineError error={error} />;
  if (drafts.length === 0) return null;
  return (
    <section aria-labelledby="mail-send-recovery-title" className="mail-send-recovery">
      <div>
        <p className="eyebrow">Send safety</p>
        <h2 id="mail-send-recovery-title">Resolve an uncertain send</h2>
        <p>
          First inspect this account’s provider Sent Mail. Never resend until you confirm whether
          the message is there.
        </p>
      </div>
      <div className="mail-send-recovery__items">
        {drafts.map((draft) => (
          <article className="mail-send-recovery__item" key={draft.id}>
            <div>
              <strong>{draft.subject || "(No subject)"}</strong>
              <span>
                {draft.reconciliationState === "in_progress"
                  ? "This send is still in progress. Ilo will refresh its state automatically."
                  : "Ilo could not confirm the provider result."}
              </span>
            </div>
            {draft.reconciliationState === "sent_mail_review_required" ? (
              <div className="mail-send-recovery__actions">
                <Button
                  aria-label={`I found ${draft.subject || "this message"} in Sent Mail`}
                  disabled={mutationPending}
                  onClick={() => reconcile(draft.id, "sent")}
                  type="button"
                >
                  I found it in Sent Mail
                </Button>
                <Button
                  aria-label={`I confirmed ${draft.subject || "this message"} was not sent`}
                  disabled={mutationPending}
                  onClick={() => reconcile(draft.id, "not_sent")}
                  tone="ghost"
                  type="button"
                >
                  It was not sent
                </Button>
              </div>
            ) : (
              <span aria-live="polite">Waiting for the provider result…</span>
            )}
          </article>
        ))}
      </div>
      {mutationError ? <InlineError error={mutationError} /> : null}
    </section>
  );
}

export function MailSidebar({ onNavigate }: { onNavigate: () => void }) {
  const [params, setParams] = useSearchParams();
  const accounts = useQuery({
    queryFn: api.listConnectors,
    queryKey: ["connectors"],
    refetchInterval: 60_000,
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
              <SidebarMenuItem>
                <SidebarMenuButton
                  aria-pressed={!mailboxId && !accountId}
                  isActive={!mailboxId && !accountId}
                  onClick={() => select({})}
                >
                  <Inbox aria-hidden="true" />
                  <span>Unified inbox</span>
                </SidebarMenuButton>
                {totalInboxUnread > 0 ? (
                  <SidebarMenuBadge>{totalInboxUnread}</SidebarMenuBadge>
                ) : null}
              </SidebarMenuItem>
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
    refetchInterval: 60_000,
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
  const unreadOnly = params.get("unread") === "1";
  const composing = params.get("compose") === "1";
  const [composeThread, setComposeThread] = useState<MailThread | null>(null);
  const composeFormRef = useRef<HTMLFormElement>(null);
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
        ...(unreadOnly ? { unread: true } : {}),
      }),
    queryKey: ["mail-threads", accountId, mailboxId, search, unreadOnly],
    refetchInterval: 60_000,
  });
  const drafts = useQuery({
    queryFn: api.listMailDrafts,
    queryKey: ["mail-drafts"],
    refetchInterval: 15_000,
  });
  const uncertainDrafts =
    drafts.data?.filter((draft) => draft.reconciliationState !== "none") ?? [];
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
  const send = useMutation({
    mutationFn: (form: FormData) => {
      const threadId = String(form.get("threadId") ?? "");
      return api.sendMail({
        accountId: String(form.get("accountId")),
        body: String(form.get("body")),
        cc: [],
        subject: String(form.get("subject")),
        ...(threadId ? { threadId } : {}),
        to: String(form.get("to"))
          .split(",")
          .map((address) => address.trim())
          .filter(Boolean)
          .map((address) => ({ address, name: null })),
      });
    },
    onSuccess: () => {
      update({ compose: null });
      setComposeThread(null);
      return client.invalidateQueries({ queryKey: ["mail-threads"] });
    },
  });
  const saveDraft = useMutation({
    mutationFn: (form: FormData) => {
      const threadId = String(form.get("threadId") ?? "");
      return api.createMailDraft({
        accountId: String(form.get("accountId")),
        body: String(form.get("body")),
        cc: [],
        subject: String(form.get("subject")),
        ...(threadId ? { threadId } : {}),
        to: String(form.get("to"))
          .split(",")
          .map((address) => address.trim())
          .filter(Boolean)
          .map((address) => ({ address, name: null })),
      });
    },
    onSuccess: () => {
      update({ compose: null });
      setComposeThread(null);
      return client.invalidateQueries({ queryKey: ["mail-drafts"] });
    },
  });
  const reconcileDraft = useMutation({
    mutationFn: ({ id, outcome }: { id: string; outcome: "not_sent" | "sent" }) =>
      api.reconcileMailDraft(id, { outcome }),
    onSuccess: () => client.invalidateQueries({ queryKey: ["mail-drafts"] }),
  });
  const sendRecovery = (
    <MailSendRecovery
      drafts={uncertainDrafts}
      error={drafts.error}
      isPending={drafts.isPending}
      mutationError={reconcileDraft.error}
      mutationPending={reconcileDraft.isPending}
      reconcile={(id, outcome) => reconcileDraft.mutate({ id, outcome })}
    />
  );
  if (accounts.isPending || mailboxes.isPending) return <WorkspaceSkeleton kind="mail" />;
  if (accounts.isError) return <InlineError error={accounts.error} />;
  if (mailboxes.isError) return <InlineError error={mailboxes.error} />;
  if (!enabled.length)
    return (
      <div className="mail-page">
        {sendRecovery}
        <div className="narrow-page">
          <p className="eyebrow">Mail for people and agents</p>
          <h1>Inbox</h1>
          <EmptyState icon={<Inbox />} title="Connect a mailbox">
            Enable Mail on a connected Google account or add iCloud from Settings.
          </EmptyState>
        </div>
      </div>
    );
  if (threads.isPending) return <WorkspaceSkeleton kind="mail" />;
  return (
    <div className="mail-page">
      {sendRecovery}
      {composing ? (
        <form
          className="mail-compose"
          onSubmit={(event) => {
            event.preventDefault();
            send.mutate(new FormData(event.currentTarget));
          }}
          ref={composeFormRef}
        >
          <input name="accountId" type="hidden" value={enabled[0]?.id ?? ""} />
          <input name="threadId" type="hidden" value={composeThread?.id ?? ""} />
          <label>
            To
            <input
              aria-label="To"
              defaultValue={composeThread?.from.address ?? ""}
              name="to"
              required
              type="email"
            />
          </label>
          <label>
            Subject
            <input
              aria-label="Subject"
              defaultValue={
                composeThread
                  ? composeThread.subject.toLowerCase().startsWith("re:")
                    ? composeThread.subject
                    : `Re: ${composeThread.subject}`
                  : ""
              }
              name="subject"
            />
          </label>
          <label>
            Message
            <textarea aria-label="Message" name="body" required />
          </label>
          {send.isError ? <InlineError error={send.error} /> : null}
          {saveDraft.isError ? <InlineError error={saveDraft.error} /> : null}
          <div>
            <Button
              onClick={() => {
                update({ compose: null });
                setComposeThread(null);
              }}
              tone="ghost"
              type="button"
            >
              Discard
            </Button>
            <Button
              disabled={saveDraft.isPending}
              onClick={() => {
                if (composeFormRef.current) saveDraft.mutate(new FormData(composeFormRef.current));
              }}
              tone="ghost"
              type="button"
            >
              {saveDraft.isPending ? "Saving…" : "Save draft"}
            </Button>
            <Button disabled={send.isPending} type="submit">
              {send.isPending ? "Sending…" : "Send"}
            </Button>
          </div>
        </form>
      ) : null}
      <div className={`mail-workspace mail-workspace--${selectedId ? "reader" : "list"}`}>
        <section aria-label="Conversations" className="mail-thread-list">
          {threads.isError ? (
            <InlineError error={threads.error} />
          ) : threads.data.length === 0 ? (
            <EmptyState icon={<Mail />} title="Nothing here">
              Try another mailbox or a broader search.
            </EmptyState>
          ) : (
            <>
              <div className="mail-thread-list__summary">
                <span>{threads.data.length} conversations</span>
                {unreadOnly ? <Badge>Unread</Badge> : null}
              </div>
              {threads.data.map((thread) => (
                <ThreadRow
                  active={selected?.id === thread.id}
                  key={thread.id}
                  select={() => update({ thread: thread.id, view: null })}
                  thread={thread}
                />
              ))}
            </>
          )}
        </section>
        <section aria-label="Message reader" className="mail-reader">
          {selected ? (
            <Reader
              archive={() =>
                updateThread.mutate({
                  id: selected.id,
                  mailboxIds: selected.mailboxIds.filter(
                    (id) => mailboxes.data.find((mailbox) => mailbox.id === id)?.role !== "inbox",
                  ),
                })
              }
              back={() => update({ thread: null })}
              pending={updateThread.isPending}
              messages={messages.data ?? []}
              reply={() => {
                setComposeThread(selected);
                update({ compose: "1" });
              }}
              snooze={() => snoozeThread.mutate(selected.id)}
              thread={selected}
              timeZone={user.planningTimezone}
              toggleStar={() =>
                updateThread.mutate({ id: selected.id, starred: !selected.starred })
              }
              toggleUnread={() =>
                updateThread.mutate({ id: selected.id, unread: !selected.unread })
              }
              trash={() => {
                const trash = mailboxes.data.find(
                  (mailbox) => mailbox.accountId === selected.accountId && mailbox.role === "trash",
                );
                if (trash) updateThread.mutate({ id: selected.id, mailboxIds: [trash.id] });
              }}
            />
          ) : selectedId && loaded.isPending ? (
            <PageLoading />
          ) : (
            <EmptyState icon={<Mail />} title="Select a conversation">
              Open a conversation to read every synced message and manage it.
            </EmptyState>
          )}
        </section>
      </div>
    </div>
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
            <ChevronDown aria-hidden="true" className="mail-sidebar__chevron" />
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
                          <ChevronDown aria-hidden="true" />
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
        {thread.starred ? <Star aria-label="Starred" fill="currentColor" size={13} /> : null}
        {thread.messageCount > 1 ? `${thread.messageCount} messages` : null}
      </span>
    </button>
  );
}
function Reader({
  archive,
  back,
  pending,
  messages,
  reply,
  snooze,
  thread,
  timeZone,
  toggleStar,
  toggleUnread,
  trash,
}: {
  archive: () => void;
  back: () => void;
  pending: boolean;
  messages: MailMessage[];
  reply: () => void;
  snooze: () => void;
  thread: MailThread;
  timeZone: string;
  toggleStar: () => void;
  toggleUnread: () => void;
  trash: () => void;
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
      <div className="mail-reader__toolbar">
        <Button className="mail-reader__back" onClick={back} tone="ghost">
          <ChevronLeft size={16} /> Inbox
        </Button>
        <Button onClick={reply} tone="ghost">
          <Reply size={16} /> Reply
        </Button>
        <Button aria-label="Snooze conversation until tomorrow" onClick={snooze} tone="ghost">
          <Clock3 size={16} /> Snooze
        </Button>
        <Button aria-label="Archive conversation" disabled={pending} onClick={archive} tone="ghost">
          <Archive size={16} />
        </Button>
        <Button
          aria-label="Move conversation to trash"
          disabled={pending}
          onClick={trash}
          tone="ghost"
        >
          <Trash2 size={16} />
        </Button>
        <Button
          aria-label={thread.starred ? "Unstar conversation" : "Star conversation"}
          disabled={pending}
          onClick={toggleStar}
          tone="ghost"
        >
          <Star fill={thread.starred ? "currentColor" : "none"} size={16} />
        </Button>
        <Button
          aria-label={thread.unread ? "Mark conversation read" : "Mark conversation unread"}
          disabled={pending}
          onClick={toggleUnread}
          tone="ghost"
        >
          {thread.unread ? <Eye size={16} /> : <EyeOff size={16} />}
        </Button>
      </div>
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
