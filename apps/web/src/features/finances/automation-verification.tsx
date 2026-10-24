import type { FinanceConversationChallenge } from "@personal-os/domain";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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
import { financeConversationRecovery, financeRecoveryHref } from "./automation-recovery.js";

export function FinanceConversationReadiness({ returnTo }: { returnTo?: string | null }) {
  const query = useQuery({
    queryKey: ["finance-conversation-readiness"],
    queryFn: api.getFinanceConversationReadiness,
  });
  return (
    <section aria-label="Finance Chat readiness" className="flex flex-col gap-2">
      <h2>Finance Chat</h2>
      <QueryFeedback query={query} title="Chat readiness could not be loaded" />
      {query.data ? (
        query.data.canSend ? (
          <p>Chat is available through an eligible verified automation.</p>
        ) : (
          <>
            <p>{financeConversationRecovery[query.data.reason].cause}</p>
            {query.data.reason !== "registration_missing" &&
            query.data.reason !== "registration_revoked" ? (
              <Button asChild variant="secondary" className="self-start">
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
    </section>
  );
}

export function AutomationHostReadiness({ scheduleId }: { scheduleId: string }) {
  const query = useQuery({
    queryKey: ["finance-conversation-host-readiness", scheduleId],
    queryFn: () => api.getFinanceConversationHostReadiness(scheduleId),
  });
  return (
    <>
      <QueryFeedback query={query} title="Host message access could not be loaded" />
      <p>
        Message access for this host:{" "}
        {query.data?.messageCapability === "verified"
          ? "verified"
          : query.data
            ? query.data.messageCapability.replaceAll("_", " ")
            : "unknown"}
        {query.data?.recovery === "authorize_execution"
          ? " · Authorize Finance execution."
          : query.data?.recovery === "reconnect"
            ? " · Reconnect the original host."
            : ""}
      </p>
    </>
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
        setChallenge(await api.issueFinanceConversationChallenge(scheduleId));
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
        client.setQueryData(["finance-conversation-host-readiness", scheduleId], hostReadiness);
        client.setQueryData(["finance-conversation-readiness"], readiness);
        await client.invalidateQueries({ queryKey: ["finance-onboarding"] });
        toast.success(
          hostReadiness.canSend
            ? "This host is ready for Finance Chat."
            : "Readiness checked. This host is not ready for Finance Chat.",
          { id: notice },
        );
      }
    } catch (error) {
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
        <Button variant="outline" disabled={disabled}>
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
