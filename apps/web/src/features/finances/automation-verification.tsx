import type { FinanceConversationChallenge } from "@personal-os/domain";
import { useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import {
  ResponsiveDialog as Dialog,
  ResponsiveDialogContent as DialogContent,
  ResponsiveDialogDescription as DialogDescription,
  ResponsiveDialogHeader as DialogHeader,
  ResponsiveDialogTitle as DialogTitle,
  ResponsiveDialogTrigger as DialogTrigger,
  ResponsiveDialogBody,
} from "@/components/responsive-dialog";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { api } from "../../api.js";
import { QueryFeedback } from "../../components/async-state.js";
import { sameSession, usePreferenceSession } from "../workspace-settings/account-save-session.js";
import { financeConversationRecovery, financeRecoveryHref } from "./automation-recovery.js";
import { FinanceHostRunSummary } from "./conversation-host-summary.js";
import { useFinanceConversationReadiness } from "./use-finance-conversation-readiness.js";

export function FinanceConversationReadiness({ returnTo }: { returnTo?: string | null }) {
  const query = useFinanceConversationReadiness();
  const client = useQueryClient();
  const session = usePreferenceSession(client);
  return (
    <section aria-label="Finance Chat readiness" className="flex min-w-0 flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2>Finance Chat</h2>
        <Button
          variant="outline"
          className="min-h-11"
          disabled={query.isFetching}
          onClick={() => {
            void (async () => {
              const notice = toast.loading("Checking readiness…");
              const [result] = await Promise.all([
                query.refetch(),
                client.invalidateQueries({ queryKey: ["finance-conversation-host-readiness"] }),
              ]);
              if (!sameSession(client, session)) {
                toast.dismiss(notice);
                return;
              }
              toast[result.isError ? "error" : "success"](
                result.isError
                  ? "Readiness could not be checked. Try again."
                  : result.data?.canSend
                    ? "Chat is ready for the next eligible run."
                    : "Readiness checked. Review the next step.",
                { id: notice },
              );
            })();
          }}
        >
          Refresh readiness
        </Button>
      </div>
      <QueryFeedback query={query} title="Chat readiness could not be loaded" />
      {query.data && !query.isError ? (
        query.data.canSend ? (
          <p>Chat is available. Messages wait for the next eligible host run.</p>
        ) : query.data.host ? (
          <p>
            <strong>Chat sending is locked.</strong> Review the next step for{" "}
            {query.data.host.label} below.
          </p>
        ) : (
          <>
            <p>
              <strong>Chat sending is locked.</strong>{" "}
              {financeConversationRecovery[query.data.reason]?.cause}
            </p>
            {query.data.reason !== "registration_missing" &&
            query.data.reason !== "registration_revoked" ? (
              <Button asChild variant="secondary" className="min-h-11 self-start">
                {financeConversationRecovery[query.data.reason].href === "/finances/automations" ? (
                  <a href="#finance-automation-list">
                    {financeConversationRecovery[query.data.reason].action}
                  </a>
                ) : (
                  <Link
                    to={
                      returnTo
                        ? financeRecoveryHref(
                            financeConversationRecovery[query.data.reason].href,
                            returnTo,
                          )
                        : financeConversationRecovery[query.data.reason].href
                    }
                  >
                    {financeConversationRecovery[query.data.reason].action}
                  </Link>
                )}
              </Button>
            ) : null}
          </>
        )
      ) : null}
      {!query.isError && query.data?.host ? (
        <p className="text-sm text-muted-foreground break-words">
          Chat host: {query.data.host.label}
        </p>
      ) : null}
      {query.isError ? (
        <p className="text-sm text-muted-foreground">
          Readiness unavailable. Refresh to check again.
        </p>
      ) : null}
    </section>
  );
}

export function AutomationHostReadiness({
  scheduleId,
  returnTo,
}: {
  scheduleId: string;
  returnTo?: string | null;
}) {
  const query = useFinanceConversationReadiness(scheduleId);
  const state = query.isError ? undefined : query.data;
  const recovery = state ? financeConversationRecovery[state.reason] : undefined;
  return (
    <div className="grid min-w-0 gap-2">
      <QueryFeedback query={query} title="Host message access could not be loaded" />
      <p className="font-medium">
        {state
          ? state.canSend
            ? "Ready for Chat"
            : "Not ready for Chat"
          : query.isPending
            ? "Checking host…"
            : "Readiness unavailable"}
      </p>
      {state && !state.canSend && recovery ? (
        <p className="text-sm text-muted-foreground">{recovery.cause}</p>
      ) : null}
      {state &&
      !state.canSend &&
      recovery &&
      state.recovery !== "verify_message_protocol" &&
      state.recovery !== "register_host" &&
      state.recovery !== "resume_registration" ? (
        <Button asChild variant="secondary" className="min-h-11 justify-self-start">
          <Link to={returnTo ? financeRecoveryHref(recovery.href, returnTo) : recovery.href}>
            {recovery.action}
          </Link>
        </Button>
      ) : null}
      {state ? (
        <p className="text-sm text-muted-foreground">
          Message access for this host: {state.messageCapability.replaceAll("_", " ")}. Messaging
          proof alone does not authorize Finance actions.
        </p>
      ) : null}
      {state?.host ? <FinanceHostRunSummary run={state.host.latestRun} /> : null}
    </div>
  );
}

export function AutomationVerification({
  scheduleId,
  disabled,
}: {
  scheduleId: string;
  disabled: boolean;
}) {
  const client = useQueryClient();
  const session = usePreferenceSession(client);
  const [challenge, setChallenge] = useState<FinanceConversationChallenge | null>(null);
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const instructions = challenge
    ? `Verify Finance message access using the original authorized host connection for schedule ${scheduleId}.\nChallenge ID: ${challenge.challengeId}\nProtocol version: ${challenge.protocolVersion}\nNonce: ${challenge.nonce}\nExpires: ${challenge.expiresAt}\nCall exchange_finance_conversation_challenge with {challengeId: "${challenge.challengeId}", operation: {kind: "fetch"}}. Then use the same outer challengeId with operation {kind: "acknowledge", challengeId: "${challenge.challengeId}", nonce: <exact nonce returned by fetch>}. Finally use the same outer challengeId with operation {kind: "respond", challengeId: "${challenge.challengeId}", response: <harmless verification reply>}. Do not report success until the server confirms the exchange. This verifies message access, not Finance maintenance.`
    : "";
  async function act(kind: "issue" | "check" | "copy") {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    const notice = toast.loading(
      kind === "issue"
        ? "Preparing verification…"
        : kind === "check"
          ? "Checking Chat readiness…"
          : "Copying verification instructions…",
    );
    let issued = false;
    try {
      if (kind === "issue") {
        const next = await api.issueFinanceConversationChallenge(scheduleId);
        if (!sameSession(client, session)) {
          toast.dismiss(notice);
          return;
        }
        setChallenge(next);
        issued = true;
        // A replacement challenge supersedes proof. Clear stale verified projections
        // before refetching, including owner-qualified Chat readiness queries.
        await Promise.all([
          client.invalidateQueries({ queryKey: ["finance-onboarding"] }),
          client.resetQueries(
            { queryKey: ["finance-conversation-readiness"] },
            { throwOnError: true },
          ),
          client.resetQueries(
            { queryKey: ["finance-conversation-host-readiness", scheduleId] },
            { throwOnError: true },
          ),
        ]);
        toast.success("Verification challenge prepared.", { id: notice });
      } else if (kind === "copy") {
        await navigator.clipboard.writeText(instructions);
        toast.success("Verification instructions copied.", { id: notice });
      } else {
        const [readiness, hostReadiness] = await Promise.all([
          api.getFinanceConversationReadiness(),
          api.getFinanceConversationHostReadiness(scheduleId),
        ]);
        if (!sameSession(client, session)) {
          toast.dismiss(notice);
          return;
        }
        client.setQueryData(
          ["finance-conversation-host-readiness", scheduleId, session.owner, session.epoch],
          hostReadiness,
        );
        client.setQueryData(
          ["finance-conversation-readiness", session.owner, session.epoch],
          readiness,
        );
        await client.invalidateQueries({ queryKey: ["finance-conversation-readiness"] });
        await client.invalidateQueries({ queryKey: ["finance-onboarding"] });
        toast.success(
          hostReadiness.canSend
            ? "This host is ready for Finance Chat."
            : "Readiness checked. This host is not ready for Finance Chat.",
          { id: notice },
        );
      }
    } catch (error) {
      if (!sameSession(client, session)) {
        toast.dismiss(notice);
        return;
      }
      toast.error(
        issued
          ? "Challenge prepared, but readiness could not be refreshed. Check Chat readiness again."
          : error instanceof Error
            ? error.message
            : "Verification could not be completed. Try again.",
        { id: notice },
      );
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" className="min-h-11" disabled={disabled}>
          Verify message access
        </Button>
      </DialogTrigger>
      <DialogContent data-finance-dialog data-finance-size="default">
        <DialogHeader>
          <DialogTitle>Verify message access</DialogTitle>
          <DialogDescription>
            The original host must fetch, acknowledge, and respond to a real server challenge.
            Registration alone does not unlock Chat.
          </DialogDescription>
        </DialogHeader>
        <ResponsiveDialogBody>
          <Button disabled={pending || disabled} onClick={() => void act("issue")}>
            {challenge ? "Prepare a new challenge" : "Prepare verification challenge"}
          </Button>
          {challenge ? (
            <>
              <Field>
                <FieldLabel htmlFor={`verification-${scheduleId}`}>
                  Instructions for your original host
                </FieldLabel>
                <Textarea
                  id={`verification-${scheduleId}`}
                  readOnly
                  value={instructions}
                  className="min-h-64"
                />
              </Field>
              <Button disabled={pending} onClick={() => void act("copy")}>
                Copy verification instructions
              </Button>
            </>
          ) : null}
          <Button variant="outline" disabled={pending} onClick={() => void act("check")}>
            Check Chat readiness
          </Button>
        </ResponsiveDialogBody>
      </DialogContent>
    </Dialog>
  );
}
