import type { MailDraft, MailRecipientInput, MailSetupAccount } from "@personal-os/domain";
import { Button } from "@personal-os/ui";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MailIcon, PlusIcon, XIcon } from "@/components/icons";
import { Button as IconButton } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { api } from "../../api.js";
import { InlineError } from "../../components/async-state.js";

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

export function FloatingMailComposer({
  accounts,
  intent,
  onIntentHandled,
}: {
  accounts: MailSetupAccount[];
  intent?: ComposeIntent | null;
  onIntentHandled?: () => void;
}) {
  const client = useQueryClient();
  const available = useMemo(
    () => accounts.filter((account) => account.sendCapability === "available"),
    [accounts],
  );
  const [open, setOpen] = useState(false);
  const [accountId, setAccountId] = useState(
    available[0]?.accountId ?? accounts[0]?.accountId ?? "",
  );
  const [to, setTo] = useState("");
  const [cc, setCc] = useState("");
  const [showCc, setShowCc] = useState(false);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [threadId, setThreadId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState<unknown>(null);
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
    if (open) toRef.current?.focus();
    else if (restoreFocusRef.current) {
      restoreFocusRef.current = false;
      triggerRef.current?.focus();
    }
  }, [open]);

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
    setError(null);
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
        setError(caught);
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
      if (nextIntent) {
        const existing = nextIntent.draft;
        if (existing) draftRef.current = existing;
        setAccountId(
          existing?.accountId ??
            nextIntent.accountId ??
            available[0]?.accountId ??
            accounts[0]?.accountId ??
            "",
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
    [accounts, available, reset],
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
    const operation = persistQueueRef.current.then(async () => {
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
      setError(null);
      await client.invalidateQueries({ queryKey: ["mail-drafts"] });
      return saved;
    });
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
        setError(caught);
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
  const selectedAccount = accounts.find((account) => account.accountId === accountId);
  const canSend =
    recipients(to).length > 0 && selectedAccount?.sendCapability === "available" && !sending;

  return (
    <div className="mail-floating-compose" data-state={open ? "open" : "closed"}>
      {open ? (
        <Card
          aria-label="New message"
          className="mail-floating-compose__card"
          onKeyDown={(event) => {
            if (event.key !== "Escape" || confirmation) return;
            event.preventDefault();
            void close();
          }}
          role="region"
        >
          <CardHeader className="mail-floating-compose__header">
            <CardTitle>New message</CardTitle>
            <IconButton
              aria-label="Close composer"
              onClick={() => void close()}
              size="icon"
              variant="ghost"
            >
              <XIcon aria-hidden="true" />
            </IconButton>
          </CardHeader>
          <CardContent className="mail-floating-compose__fields">
            <label htmlFor="mail-compose-from">
              <span>From</span>
              <NativeSelect
                aria-label="From"
                id="mail-compose-from"
                onChange={(event) => {
                  setAccountId(event.target.value);
                  editVersionRef.current += 1;
                  setDirty(true);
                }}
                value={accountId}
              >
                {accounts.map((account) => (
                  <NativeSelectOption
                    disabled={account.sendCapability !== "available"}
                    key={account.accountId}
                    value={account.accountId}
                  >
                    {account.label}
                    {account.email ? ` · ${account.email}` : ""}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </label>
            <label htmlFor="mail-compose-to">
              <span>To</span>
              <Input
                aria-label="To"
                id="mail-compose-to"
                onChange={(event) => change(setTo, event.target.value)}
                placeholder="name@example.com"
                ref={toRef}
                value={to}
              />
              {!showCc ? (
                <button
                  className="mail-floating-compose__cc-toggle"
                  onClick={() => setShowCc(true)}
                  type="button"
                >
                  Cc
                </button>
              ) : null}
            </label>
            {showCc ? (
              <label htmlFor="mail-compose-cc">
                <span>Cc</span>
                <Input
                  aria-label="Cc"
                  id="mail-compose-cc"
                  onChange={(event) => change(setCc, event.target.value)}
                  value={cc}
                />
              </label>
            ) : null}
            <label htmlFor="mail-compose-subject">
              <span>Subject</span>
              <Input
                aria-label="Subject"
                id="mail-compose-subject"
                onChange={(event) => change(setSubject, event.target.value)}
                value={subject}
              />
            </label>
            <label className="mail-floating-compose__message" htmlFor="mail-compose-message">
              <span className="sr-only">Message</span>
              <Textarea
                aria-label="Message"
                id="mail-compose-message"
                onChange={(event) => change(setBody, event.target.value)}
                placeholder="Write a message…"
                value={body}
              />
            </label>
            {selectedAccount?.sendCapability === "reconnect" ? (
              <p className="mail-floating-compose__warning" role="alert">
                Reconnect this account before sending. Your draft will remain saved.
              </p>
            ) : null}
            {error ? <InlineError error={error} /> : null}
          </CardContent>
          <CardFooter className="mail-floating-compose__footer">
            <Button
              disabled={!canSend}
              onClick={() => {
                setSaveState("saving");
                void persist().then(setConfirmation).catch(setError);
              }}
            >
              Review and send
            </Button>
            <span aria-live="polite">
              {saveState === "saving" ? "Saving…" : saveState === "saved" ? "Saved" : ""}
            </span>
          </CardFooter>
        </Card>
      ) : (
        <IconButton
          aria-label="Compose a message"
          className="mail-floating-compose__trigger"
          onClick={() => openComposer()}
          ref={triggerRef}
          size="icon-lg"
        >
          <PlusIcon aria-hidden="true" />
        </IconButton>
      )}
      <Dialog onOpenChange={(next) => !next && setConfirmation(null)} open={Boolean(confirmation)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Send this message?</DialogTitle>
            <DialogDescription>
              This sends from {selectedAccount?.email ?? selectedAccount?.label} to {to}.
            </DialogDescription>
          </DialogHeader>
          <div className="mail-floating-compose__confirmation">
            <MailIcon aria-hidden="true" />
            <div>
              <strong>{subject || "(No subject)"}</strong>
              <span>{to}</span>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => setConfirmation(null)} tone="ghost">
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
                    void close(true);
                  })
                  .catch(async (caught) => {
                    await client.invalidateQueries({ queryKey: ["mail-drafts"] });
                    setError(caught);
                    setSending(false);
                    setConfirmation(null);
                  });
              }}
            >
              Send message
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
