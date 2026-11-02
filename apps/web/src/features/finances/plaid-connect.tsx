import type { ExchangePlaidTokenInput } from "@personal-os/domain";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { usePlaidLink } from "react-plaid-link";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { api } from "../../api.js";
import { InlineError } from "../../components/async-state.js";
import { MutationFeedback } from "../../components/mutation-feedback.js";
import { useFeedbackMutation } from "../../lib/use-feedback-mutation.js";
import { isConfirmedFinanceMutationFailure } from "./mutation-retry.js";

export function PlaidConnectButton({
  label = "Connect bank",
  onConnected,
  accountId,
}: {
  label?: string;
  accountId?: string;
  onConnected: () => Promise<unknown>;
}) {
  const status = useQuery({ queryFn: api.getPlaidStatus, queryKey: ["plaid-status"] });

  if (status.isPending) {
    return (
      <Button disabled size="sm" variant="outline">
        Checking Plaid
      </Button>
    );
  }
  if (status.isError)
    return (
      <InlineError
        error={status.error}
        title="Couldn’t check bank connection availability."
        retry={() => status.refetch()}
      />
    );
  if (!status.data.available) {
    return (
      <Button disabled size="sm" variant="outline">
        Plaid needs keys
      </Button>
    );
  }
  const environmentLabel =
    status.data.environment === "sandbox"
      ? "Sandbox test bank"
      : status.data.environment === "development"
        ? "Development test bank"
        : null;
  return (
    <AvailablePlaidConnectButton
      {...(accountId ? { accountId } : {})}
      label={environmentLabel ? `${label} · ${environmentLabel}` : label}
      onConnected={onConnected}
    />
  );
}

function AvailablePlaidConnectButton({
  accountId,
  label,
  onConnected,
}: {
  accountId?: string;
  label: string;
  onConnected: () => Promise<unknown>;
}) {
  const [token, setToken] = useState<string | null>(null);
  const [reconnectKey, setReconnectKey] = useState(() => crypto.randomUUID());
  const linkToken = useFeedbackMutation({
    feedback: { action: "open bank connection", safeToRetry: true, form: false },
    mutationFn: () => api.getPlaidLinkToken(accountId),
    onSuccess: setToken,
  });
  const exchange = useFeedbackMutation({
    feedback: { action: "connect this bank", safeToRetry: false, form: false },
    mutationFn: (input: ExchangePlaidTokenInput) => api.exchangePlaidToken(input),
    onSuccess: onConnected,
  });
  const reconnect = useFeedbackMutation({
    feedback: {
      action: "verify bank authorization and schedule synchronization",
      pending: "Verifying bank authorization…",
      success: "Bank authorization verified; synchronization scheduled.",
      safeToRetry: true,
      form: false,
    },
    mutationFn: () => {
      if (!accountId) throw new Error("Choose an account to reconnect.");
      return api.completePlaidReconnect(accountId, reconnectKey);
    },
    onError: (error) => {
      if (isConfirmedFinanceMutationFailure(error)) setReconnectKey(crypto.randomUUID());
    },
    onSuccess: async () => {
      setReconnectKey(crypto.randomUUID());
      await onConnected();
    },
  });
  const { open, ready } = usePlaidLink({
    onSuccess: (publicToken, metadata) => {
      if (accountId) {
        reconnect.mutate();
        return;
      }
      if (!publicToken) {
        toast.error("Plaid completed without a bank connection. Try connecting again.");
        return;
      }
      exchange.mutate({
        publicToken,
        institution: metadata?.institution?.name ?? null,
        metadata: {
          institutionId: metadata?.institution?.institution_id ?? null,
          accounts: (metadata?.accounts ?? []).map((account) => ({
            name: account.name,
            mask: account.mask,
          })),
        },
      });
    },
    token,
  });

  useEffect(() => {
    if (token && ready) open();
  }, [open, ready, token]);

  return (
    <div className="plaid-connect">
      <Button
        disabled={linkToken.isPending || exchange.isPending || reconnect.isPending}
        onClick={() => {
          linkToken.mutate();
        }}
        size="sm"
      >
        {linkToken.isPending || exchange.isPending || reconnect.isPending
          ? "Connecting bank"
          : label}
      </Button>
      <MutationFeedback feedback={linkToken.feedback} />
      <MutationFeedback feedback={exchange.feedback} />
      <MutationFeedback feedback={reconnect.feedback} />
    </div>
  );
}
