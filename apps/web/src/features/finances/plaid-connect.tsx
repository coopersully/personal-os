import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { usePlaidLink } from "react-plaid-link";
import { Button } from "@/components/ui/button";
import { api, errorMessage } from "../../api.js";

export function PlaidConnectButton({
  label = "Connect bank",
  onConnected,
}: {
  label?: string;
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
  if (status.isError || !status.data.available) {
    return (
      <Button disabled size="sm" variant="outline">
        Plaid needs keys
      </Button>
    );
  }
  return <AvailablePlaidConnectButton label={label} onConnected={onConnected} />;
}

function AvailablePlaidConnectButton({
  label,
  onConnected,
}: {
  label: string;
  onConnected: () => Promise<unknown>;
}) {
  const [token, setToken] = useState<string | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);
  const linkToken = useMutation({
    mutationFn: api.getPlaidLinkToken,
    onSuccess: setToken,
  });
  const exchange = useMutation({
    mutationFn: (publicToken: string) => api.exchangePlaidToken({ institution: null, publicToken }),
    onSuccess: onConnected,
  });
  const { open, ready } = usePlaidLink({
    onSuccess: (publicToken) => {
      if (!publicToken) {
        setLinkError("Plaid completed without a bank connection. Try connecting again.");
        return;
      }
      setLinkError(null);
      exchange.mutate(publicToken);
    },
    token,
  });

  useEffect(() => {
    if (token && ready) open();
  }, [open, ready, token]);

  return (
    <div className="plaid-connect">
      <Button
        disabled={linkToken.isPending || exchange.isPending}
        onClick={() => {
          setLinkError(null);
          linkToken.mutate();
        }}
        size="sm"
      >
        {linkToken.isPending || exchange.isPending ? "Connecting bank" : label}
      </Button>
      {linkError ? (
        <p className="form-error" role="alert">
          {linkError}
        </p>
      ) : linkToken.isError || exchange.isError ? (
        <p className="form-error" role="alert">
          {errorMessage(linkToken.error ?? exchange.error)}
        </p>
      ) : null}
    </div>
  );
}
