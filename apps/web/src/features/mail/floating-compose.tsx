import type { MailDraft, MailRecipientInput, MailSetupAccount } from "@personal-os/domain";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { MailIcon, PlugIcon, PlusIcon } from "@/components/icons";
import {
  ResponsiveDialog,
  ResponsiveDialogActions,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/responsive-dialog";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { api, errorMessage } from "../../api.js";

export type ComposeIntent = {
  accountId?: string;
  body?: string;
  draft?: MailDraft;
  subject?: string;
  threadId?: string;
  to?: string;
};

function recipients(value: string): MailRecipientInput[] {
  return value
    .split(",")
    .map((address) => address.trim())
    .filter(Boolean)
    .map((address) => ({ address, name: null }));
}

function accountInitials(account: MailSetupAccount) {
  return account.label
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export function FloatingMailComposer({
  accounts,
  accountsState = "ready",
  intent,
  onIntentHandled,
  onRetryAccounts,
}: {
  accounts: MailSetupAccount[];
  accountsState?: "error" | "loading" | "ready";
  intent?: ComposeIntent | null;
  onIntentHandled?: () => void;
  onRetryAccounts?: () => void;
}) {
  const client = useQueryClient();
  const navigate = useNavigate();
  const available = useMemo(
    () => accounts.filter((account) => account.sendCapability === "available"),
    [accounts],
  );
  const reconnectable = useMemo(
    () => accounts.filter((account) => account.sendCapability === "reconnect"),
    [accounts],
  );
  const [open, setOpen] = useState(false);
  const [accountId, setAccountId] = useState(available[0]?.accountId ?? "");
  const [to, setTo] = useState("");
  const [cc, setCc] = useState("");
  const [showCc, setShowCc] = useState(false);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [threadId, setThreadId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const [confirmation, setConfirmation] = useState<MailDraft | null>(null);
  const [sending, setSending] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const toRef = useRef<HTMLInputElement>(null);
  const draftRef = useRef<MailDraft | null>(null);
  const editVersionRef = useRef(0);
  const persistQueueRef = useRef<Promise<void>>(Promise.resolve());
  const saveTimeoutRef = useRef<number | null>(null);
  const restoreFocusRef = useRef(false);

  useEffect(() => {
    setAccountId((current) =>
      accounts.some((account) => account.accountId === current)
        ? current
        : (available[0]?.accountId ?? ""),
    );
  }, [accounts, available]);

  useEffect(() => {
    if (open && accountsState === "ready" && available.length) toRef.current?.focus();
    else if (restoreFocusRef.current) {
      restoreFocusRef.current = false;
      triggerRef.current?.focus();
    }
  }, [accountsState, available.length, open]);

  const reset = useCallback(() => {
    draftRef.current = null;
    editVersionRef.current = 0;
    setTo("");
    setCc("");
    setShowCc(false);
    setSubject("");
    setBody("");
    setThreadId(null);
    setDirty(false);
    setSaveState("idle");
  }, []);
  const close = async (skipSave = false) => {
    if (saveTimeoutRef.current !== null) {
      window.clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = null;
    }
    if (!skipSave && dirty && accountId) {
      setSaveState("saving");
      try {
        await persist();
      } catch (caught) {
        toast.error("Draft couldn’t be saved", { description: errorMessage(caught) });
        setSaveState("idle");
        return;
      }
    }
    restoreFocusRef.current = true;
    setOpen(false);
    setConfirmation(null);
  };
  const openComposer = useCallback(
    (nextIntent?: ComposeIntent | null) => {
      reset();
      setAccountId((current) =>
        available.some((account) => account.accountId === current)
          ? current
          : (available[0]?.accountId ?? ""),
      );
      if (nextIntent) {
        const existing = nextIntent.draft;
        if (existing) draftRef.current = existing;
        const preferredAccountId = existing?.accountId ?? nextIntent.accountId;
        setAccountId(
          available.some((account) => account.accountId === preferredAccountId)
            ? (preferredAccountId ?? "")
            : (available[0]?.accountId ?? ""),
        );
        setTo(existing?.to.map((recipient) => recipient.address).join(", ") ?? nextIntent.to ?? "");
        setCc(existing?.cc.map((recipient) => recipient.address).join(", ") ?? "");
        setShowCc(Boolean(existing?.cc.length));
        setSubject(existing?.subject ?? nextIntent.subject ?? "");
        setBody(existing?.body ?? nextIntent.body ?? "");
        setThreadId(existing?.threadId ?? nextIntent.threadId ?? null);
        setSaveState(existing ? "saved" : "idle");
        const hasUnsavedIntent =
          !existing && Boolean(nextIntent.to || nextIntent.subject || nextIntent.body);
        editVersionRef.current = hasUnsavedIntent ? 1 : 0;
        setDirty(hasUnsavedIntent);
      }
      setOpen(true);
    },
    [available, reset],
  );

  useEffect(() => {
    if (!intent) return;
    openComposer(intent);
    onIntentHandled?.();
  }, [intent, onIntentHandled, openComposer]);

  const snapshot = useCallback(
    () => ({
      accountId,
      body,
      cc: recipients(cc),
      subject,
      threadId,
      to: recipients(to),
    }),
    [accountId, body, cc, subject, threadId, to],
  );
  const persist = useCallback((): Promise<MailDraft> => {
    const payload = snapshot();
    const requestedVersion = editVersionRef.current;
    const run = async () => {
      const existing = draftRef.current;
      const saved = existing
        ? await api.updateMailDraft(existing.id, {
            ...payload,
            expectedUpdatedAt: existing.updatedAt,
          })
        : await api.createMailDraft(payload);
      draftRef.current = saved;
      if (editVersionRef.current === requestedVersion) {
        setDirty(false);
        setSaveState("saved");
      }
      await client.invalidateQueries({ queryKey: ["mail-drafts"] });
      return saved;
    };
    const operation = persistQueueRef.current.then(run, run);
    persistQueueRef.current = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }, [client, snapshot]);

  useEffect(() => {
    if (!open || !dirty || !accountId) return;
    setSaveState("saving");
    const timeout = window.setTimeout(() => {
      saveTimeoutRef.current = null;
      void persist().catch((caught) => {
        toast.error("Draft couldn’t be saved", { description: errorMessage(caught) });
        setSaveState("idle");
      });
    }, 650);
    saveTimeoutRef.current = timeout;
    return () => {
      window.clearTimeout(timeout);
      if (saveTimeoutRef.current === timeout) saveTimeoutRef.current = null;
    };
  }, [accountId, dirty, open, persist]);

  const change = (setter: (value: string) => void, value: string) => {
    setter(value);
    editVersionRef.current += 1;
    setDirty(true);
  };
  const selectedAccount = available.find((account) => account.accountId === accountId);
  const soleAccount = available.length === 1 ? available[0] : undefined;
  const canSend =
    recipients(to).length > 0 && selectedAccount?.sendCapability === "available" && !sending;
  const openConnections = async () => {
    if (saveTimeoutRef.current !== null) {
      window.clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = null;
    }
    try {
      if (dirty && accountId) await persist();
      else await persistQueueRef.current;
      navigate("/settings?section=connections");
    } catch (caught) {
      toast.error("Draft couldn’t be saved", { description: errorMessage(caught) });
      setSaveState("idle");
    }
  };

  return (
    <>
      <div className="mail-floating-compose" data-state={open ? "open" : "closed"}>
        {!open ? (
          <Button
            aria-label="Compose a message"
            className="mail-floating-compose__trigger"
            onClick={() => openComposer()}
            ref={triggerRef}
            size="icon-lg"
          >
            <PlusIcon aria-hidden="true" />
          </Button>
        ) : null}
      </div>
      <ResponsiveDialog
        onOpenChange={(nextOpen) => {
          if (!nextOpen && !confirmation) void close();
        }}
        open={open}
      >
        <ResponsiveDialogContent
          className="mail-compose-dialog sm:max-w-[42rem]"
          showCloseButton={!confirmation}
        >
          <ResponsiveDialogHeader className="mail-floating-compose__header">
            <ResponsiveDialogTitle>New message</ResponsiveDialogTitle>
            <ResponsiveDialogDescription className="sr-only">
              Compose and save a mail draft before sending.
            </ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          <ResponsiveDialogBody className="mail-floating-compose__fields">
            {accountsState === "loading" ? (
              <Alert>
                <MailIcon aria-hidden="true" />
                <AlertTitle>Loading mail accounts…</AlertTitle>
                <AlertDescription>
                  Checking which connected accounts can send this message.
                </AlertDescription>
              </Alert>
            ) : accountsState === "error" ? (
              <Alert variant="destructive">
                <PlugIcon aria-hidden="true" />
                <AlertTitle>Mail accounts are unavailable</AlertTitle>
                <AlertDescription>
                  Try loading your account connections again before composing.
                </AlertDescription>
                {onRetryAccounts ? (
                  <AlertAction>
                    <Button onClick={onRetryAccounts} size="sm">
                      Try again
                    </Button>
                  </AlertAction>
                ) : null}
              </Alert>
            ) : !available.length ? (
              <Alert variant="warning">
                <PlugIcon aria-hidden="true" />
                <AlertTitle>
                  {reconnectable.length
                    ? "Reconnect an account to compose"
                    : "No account can send mail"}
                </AlertTitle>
                <AlertDescription>
                  {reconnectable.length
                    ? "None of your mail accounts can send right now. Existing drafts remain saved."
                    : "Add or update a mail account in Connections before composing a message."}
                </AlertDescription>
                <AlertAction>
                  <Button onClick={() => void openConnections()} size="sm">
                    {reconnectable.length === 1
                      ? "Reconnect account"
                      : reconnectable.length > 1
                        ? `Reconnect ${reconnectable.length} accounts`
                        : "Manage accounts"}
                  </Button>
                </AlertAction>
              </Alert>
            ) : (
              <FieldGroup>
                <Field orientation="horizontal">
                  <FieldLabel>From</FieldLabel>
                  {soleAccount ? (
                    <fieldset aria-label="From" className="mail-compose-sender">
                      <Avatar size="sm">
                        <AvatarFallback>{accountInitials(soleAccount)}</AvatarFallback>
                      </Avatar>
                      <span>
                        <strong>{soleAccount.label}</strong>
                        {soleAccount.email ? <small>{soleAccount.email}</small> : null}
                      </span>
                    </fieldset>
                  ) : (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          aria-label="From"
                          className="mail-compose-sender mail-compose-sender--button"
                          variant="secondary"
                        >
                          {selectedAccount ? (
                            <>
                              <Avatar size="sm">
                                <AvatarFallback>{accountInitials(selectedAccount)}</AvatarFallback>
                              </Avatar>
                              <span>
                                <strong>{selectedAccount.label}</strong>
                                {selectedAccount.email ? (
                                  <small>{selectedAccount.email}</small>
                                ) : null}
                              </span>
                            </>
                          ) : null}
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start" className="mail-compose-sender-menu">
                        <DropdownMenuLabel>Send from</DropdownMenuLabel>
                        <DropdownMenuRadioGroup
                          onValueChange={(value) => {
                            setAccountId(value);
                            editVersionRef.current += 1;
                            setDirty(true);
                          }}
                          value={accountId}
                        >
                          {available.map((account) => (
                            <DropdownMenuRadioItem
                              key={account.accountId}
                              value={account.accountId}
                            >
                              <span>
                                {account.label}
                                {account.email ? ` · ${account.email}` : ""}
                              </span>
                            </DropdownMenuRadioItem>
                          ))}
                        </DropdownMenuRadioGroup>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </Field>
                <Field orientation="horizontal">
                  <FieldLabel htmlFor="mail-compose-to">To</FieldLabel>
                  <div className="mail-floating-compose__recipient-field">
                    <Input
                      aria-label="To"
                      autoComplete="email"
                      id="mail-compose-to"
                      multiple
                      name="to"
                      onChange={(event) => change(setTo, event.target.value)}
                      placeholder="name@example.com"
                      ref={toRef}
                      spellCheck={false}
                      type="email"
                      value={to}
                    />
                    {!showCc ? (
                      <Button
                        onClick={() => setShowCc(true)}
                        size="xs"
                        type="button"
                        variant="ghost"
                      >
                        Cc
                      </Button>
                    ) : null}
                  </div>
                </Field>
                {showCc ? (
                  <Field orientation="horizontal">
                    <FieldLabel htmlFor="mail-compose-cc">Cc</FieldLabel>
                    <Input
                      aria-label="Cc"
                      autoComplete="email"
                      id="mail-compose-cc"
                      multiple
                      name="cc"
                      onChange={(event) => change(setCc, event.target.value)}
                      spellCheck={false}
                      type="email"
                      value={cc}
                    />
                  </Field>
                ) : null}
                <Field orientation="horizontal">
                  <FieldLabel htmlFor="mail-compose-subject">Subject</FieldLabel>
                  <Input
                    aria-label="Subject"
                    id="mail-compose-subject"
                    name="subject"
                    onChange={(event) => change(setSubject, event.target.value)}
                    value={subject}
                  />
                </Field>
                <Field className="mail-floating-compose__message">
                  <FieldLabel className="sr-only" htmlFor="mail-compose-message">
                    Message
                  </FieldLabel>
                  <Textarea
                    aria-label="Message"
                    id="mail-compose-message"
                    name="message"
                    onChange={(event) => change(setBody, event.target.value)}
                    placeholder="Write a message…"
                    value={body}
                  />
                </Field>
              </FieldGroup>
            )}
          </ResponsiveDialogBody>
          <ResponsiveDialogFooter className="mail-floating-compose__footer">
            <span aria-live="polite">
              {saveState === "saving" ? "Saving…" : saveState === "saved" ? "Saved" : ""}
            </span>
            <ResponsiveDialogActions>
              <Button
                disabled={accountsState !== "ready" || !accountId || saveState === "saving"}
                onClick={() => {
                  setSaveState("saving");
                  void persist()
                    .then(() => toast.success("Draft saved"))
                    .catch((caught) => {
                      setSaveState("idle");
                      toast.error("Draft couldn’t be saved", { description: errorMessage(caught) });
                    });
                }}
                variant="secondary"
              >
                Save draft
              </Button>
              <Button
                disabled={!canSend}
                onClick={() => {
                  setSaveState("saving");
                  void persist()
                    .then(setConfirmation)
                    .catch((caught) => {
                      setSaveState("idle");
                      toast.error("Draft couldn’t be saved", { description: errorMessage(caught) });
                    });
                }}
              >
                Review and send
              </Button>
            </ResponsiveDialogActions>
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      </ResponsiveDialog>
      <ResponsiveDialog
        onOpenChange={(next) => !next && setConfirmation(null)}
        open={Boolean(confirmation)}
      >
        <ResponsiveDialogContent>
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>Send this message?</ResponsiveDialogTitle>
            <ResponsiveDialogDescription>
              This sends from {selectedAccount?.email ?? selectedAccount?.label} to {to}.
            </ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          <ResponsiveDialogBody>
            <div className="mail-floating-compose__confirmation">
              <MailIcon aria-hidden="true" />
              <div>
                <strong>{subject || "(No subject)"}</strong>
                <span>{to}</span>
              </div>
            </div>
          </ResponsiveDialogBody>
          <ResponsiveDialogFooter>
            <ResponsiveDialogActions>
              <Button onClick={() => setConfirmation(null)} variant="ghost">
                Keep editing
              </Button>
              <Button
                disabled={sending}
                onClick={() => {
                  if (!confirmation) return;
                  setSending(true);
                  void api
                    .sendMailDraft({
                      confirmedUpdatedAt: confirmation.updatedAt,
                      draftId: confirmation.id,
                    })
                    .then(async () => {
                      await client.invalidateQueries({ queryKey: ["mail-drafts"] });
                      setSending(false);
                      toast.success("Message sent");
                      void close(true);
                    })
                    .catch(async (caught) => {
                      await client.invalidateQueries({ queryKey: ["mail-drafts"] });
                      toast.error("Message couldn’t be sent", {
                        description: errorMessage(caught),
                      });
                      setSending(false);
                      setConfirmation(null);
                    });
                }}
              >
                Send message
              </Button>
            </ResponsiveDialogActions>
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      </ResponsiveDialog>
    </>
  );
}
