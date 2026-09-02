import type {
  ConnectorAuthorizationOutcome,
  ConnectorAuthorizationProvider,
} from "@personal-os/domain";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "@/api";
import { CircleAlertIcon, CircleCheckIcon, LoaderIcon } from "@/components/icons";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

type Props = {
  loadAttempt?: (id: string) => Promise<ConnectorAuthorizationOutcome>;
  onConnected?: () => void;
  onRetry: (provider: ConnectorAuthorizationProvider | null) => void;
};

const providerLabel = (provider: ConnectorAuthorizationProvider) => {
  switch (provider) {
    case "google":
      return "Google";
    case "x":
      return "X";
    default:
      return "Account provider";
  }
};

function presentation(outcome: ConnectorAuthorizationOutcome) {
  const provider = providerLabel(outcome.provider);
  switch (outcome.status) {
    case "connected":
      return {
        description: "nohmi will keep this account up to date automatically.",
        retry: false,
        title: `${provider} is connected`,
        variant: "info" as const,
      };
    case "cancelled":
      return {
        description: "Nothing changed. Try again whenever you're ready.",
        retry: true,
        title: "Connection cancelled",
        variant: "warning" as const,
      };
    case "expired":
      return {
        description: "For your security, connection links expire. Start again to continue.",
        retry: true,
        title: "Connection link expired",
        variant: "warning" as const,
      };
    case "permission_incomplete":
      return {
        description:
          "Calendar and Mail need the permissions shown by Google. Start again and allow each selected service.",
        retry: true,
        title: "Google needs permission",
        variant: "warning" as const,
      };
    case "failed":
      return {
        description: outcome.retryable
          ? "The provider was temporarily unavailable. Your existing connection was not changed."
          : "Your existing connection was not changed. Start again to finish securely.",
        retry: true,
        title: `${provider} couldn't connect`,
        variant: "destructive" as const,
      };
    case "pending":
      return {
        description: "This usually takes only a moment.",
        retry: false,
        title: `Finishing your ${provider} connection`,
        variant: "info" as const,
      };
    default:
      return {
        description: "nohmi couldn't confirm that connection. Start again to continue securely.",
        retry: true,
        title: "Restart the connection",
        variant: "warning" as const,
      };
  }
}

export function ConnectionAuthorizationOutcome({
  loadAttempt = api.getConnectorAuthorizationAttempt,
  onConnected,
  onRetry,
}: Props) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [attemptId] = useState(() => searchParams.get("connection_attempt"));
  const [restartRequired] = useState(
    () => searchParams.get("connection_result") === "restart_required",
  );
  const [pendingTimedOut, setPendingTimedOut] = useState(false);
  const query = useQuery({
    enabled: Boolean(attemptId),
    queryFn: () => {
      if (!attemptId) throw new Error("The connection attempt is unavailable.");
      return loadAttempt(attemptId);
    },
    queryKey: ["connector-authorization-attempt", attemptId],
    refetchInterval: (state) =>
      state.state.data?.status === "pending" && !pendingTimedOut ? 1_000 : false,
  });
  const announcedConnected = useRef(false);

  useEffect(() => {
    if (query.data?.status !== "connected" || announcedConnected.current) return;
    announcedConnected.current = true;
    onConnected?.();
  }, [onConnected, query.data?.status]);

  useEffect(() => {
    if (query.data?.status !== "pending") {
      setPendingTimedOut(false);
      return;
    }
    const timeout = window.setTimeout(() => setPendingTimedOut(true), 30_000);
    return () => window.clearTimeout(timeout);
  }, [query.data?.status]);

  useEffect(() => {
    if (!attemptId && !restartRequired) return;
    if (attemptId && query.isPending) return;
    const next = new URLSearchParams(searchParams);
    next.delete("connection_attempt");
    next.delete("connection_result");
    setSearchParams(next, { replace: true });
  }, [attemptId, query.isPending, restartRequired, searchParams, setSearchParams]);

  if (restartRequired) {
    return (
      <Alert variant="warning">
        <CircleAlertIcon />
        <AlertTitle>Restart the connection</AlertTitle>
        <AlertDescription>
          That connection link is no longer available. Start a new connection to continue.
        </AlertDescription>
        <AlertAction>
          <Button onClick={() => onRetry(null)} size="sm" type="button">
            Connect an account
          </Button>
        </AlertAction>
      </Alert>
    );
  }
  if (!attemptId) return null;
  if (query.isPending) {
    return (
      <Alert variant="info">
        <LoaderIcon />
        <AlertTitle>Confirming your connection</AlertTitle>
        <AlertDescription>Checking the secure result with nohmi.</AlertDescription>
      </Alert>
    );
  }
  if (!query.data) {
    return (
      <Alert variant="warning">
        <CircleAlertIcon />
        <AlertTitle>Restart the connection</AlertTitle>
        <AlertDescription>
          nohmi couldn't confirm that connection. Start again; your existing account was not
          changed.
        </AlertDescription>
        <AlertAction>
          <Button onClick={() => onRetry(null)} size="sm" type="button">
            Connect an account
          </Button>
        </AlertAction>
      </Alert>
    );
  }

  const view =
    query.data.status === "pending" && pendingTimedOut
      ? {
          description: "This is taking longer than expected. Start again to finish securely.",
          retry: true,
          title: "Restart the connection",
          variant: "warning" as const,
        }
      : presentation(query.data);
  return (
    <Alert variant={view.variant}>
      {query.data.status === "connected" ? <CircleCheckIcon /> : <CircleAlertIcon />}
      <AlertTitle>{view.title}</AlertTitle>
      <AlertDescription>{view.description}</AlertDescription>
      {view.retry ? (
        <AlertAction>
          <Button onClick={() => onRetry(query.data.provider)} size="sm" type="button">
            Try again
          </Button>
        </AlertAction>
      ) : null}
    </Alert>
  );
}
