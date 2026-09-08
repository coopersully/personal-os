import type { MailDraft, MailRecipientInput, MailSetupAccount } from "@personal-os/domain";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MailIcon, PlusIcon, XIcon } from "@/components/icons";
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
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
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
            <Button
              aria-label="Close composer"
              onClick={() => void close()}
              size="icon"
              variant="ghost"
            >
              <XIcon aria-hidden="true" />
            </Button>
          </CardHeader>
          <CardContent className="mail-floating-compose__fields">
            <FieldGroup>
              <Field orientation="horizontal">
                <FieldLabel htmlFor="mail-compose-from">From</FieldLabel>
                <NativeSelect
                  aria-label="From"
                  id="mail-compose-from"
                  name="from"
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
                    <Button onClick={() => setShowCc(true)} size="xs" type="button" variant="ghost">
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
            {selectedAccount?.sendCapability === "reconnect" ? (
              <Alert variant="warning">
                <AlertTitle>Reconnect required</AlertTitle>
                <AlertDescription>
                  Reconnect this account before sending. Your draft will remain saved.
                </AlertDescription>
              </Alert>
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
        <Button
          aria-label="Compose a message"
          className="mail-floating-compose__trigger"
          onClick={() => openComposer()}
          ref={triggerRef}
          size="icon-lg"
        >
          <PlusIcon aria-hidden="true" />
        </Button>
      )}
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
            </ResponsiveDialogActions>
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      </ResponsiveDialog>
    </div>
  );
}
