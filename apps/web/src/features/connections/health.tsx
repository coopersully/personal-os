import type { ConnectedAccountHealth } from "@personal-os/domain";
import { AlertTriangleIcon, RefreshIcon } from "@/components/icons";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "../../components/ui/alert.js";
import { Badge } from "../../components/ui/badge.js";
import { formatRelativeTime } from "../../lib/time-format.js";

export function ConnectionHealthBadge({ health }: { health: ConnectedAccountHealth }) {
  if (health.state === "syncing") {
    return (
      <Badge aria-live="polite" variant="secondary">
        <RefreshIcon aria-hidden="true" className="spin" data-icon="inline-start" /> Syncing
      </Badge>
    );
  }
  if (health.state === "retrying") {
    return (
      <Badge aria-live="polite" variant="secondary">
        Retrying automatically
      </Badge>
    );
  }
  if (health.state === "reconnect") {
    return <Badge variant="destructive">Reconnect required</Badge>;
  }
  if (health.state === "service_attention") {
    return <Badge variant="outline">ilo is resolving this</Badge>;
  }
  return <Badge variant="secondary">Ready</Badge>;
}

export function ConnectionHealthDescription({
  health,
  lastSyncedAt,
  now = Date.now(),
}: {
  health: ConnectedAccountHealth;
  lastSyncedAt: string | null;
  now?: number;
}) {
  if (health.state === "syncing") return <>Sync in progress.</>;
  if (health.state === "retrying") {
    return (
      <>
        {health.message ?? "This connection is temporarily unavailable."}
        {health.nextSyncAt ? ` Next attempt ${formatRelativeTime(health.nextSyncAt, now)}.` : null}
      </>
    );
  }
  if (health.state === "reconnect") {
    return <>{health.message ?? "Reconnect this account to resume syncing."}</>;
  }
  if (health.state === "service_attention") {
    return <>{health.message ?? "ilo is resolving a connection issue."}</>;
  }
  return <>{lastSyncedAt ? `Synced ${formatRelativeTime(lastSyncedAt, now)}` : "Ready to sync"}</>;
}

export function ConnectionRecoveryAlert({
  accounts,
}: {
  accounts: Array<{
    health?: ConnectedAccountHealth;
    id: string;
    label: string;
    syncStatus?: string;
  }>;
}) {
  const reconnecting = accounts.filter(
    (account) => connectionHealth(account).state === "reconnect",
  );
  if (reconnecting.length === 0) return null;
  return (
    <Alert variant="warning">
      <AlertTriangleIcon aria-hidden="true" />
      <AlertTitle>Reconnect {reconnecting.length === 1 ? "an account" : "accounts"}</AlertTitle>
      <AlertDescription>
        {reconnecting.map((account) => account.label).join(", ")} needs authorization before new
        information can sync.
      </AlertDescription>
      <AlertAction>
        <a href="/settings?section=connections">Review connections</a>
      </AlertAction>
    </Alert>
  );
}

export function connectionHealth(account: {
  health?: ConnectedAccountHealth;
  syncStatus?: string;
}): ConnectedAccountHealth {
  if (account.health) return account.health;
  if (account.syncStatus === "syncing") {
    return { message: null, nextSyncAt: null, recovery: null, state: "syncing" };
  }
  if (account.syncStatus === "error") {
    return {
      message: "This connection needs attention. ilo is resolving this.",
      nextSyncAt: null,
      recovery: "operator",
      state: "service_attention",
    };
  }
  return { message: null, nextSyncAt: null, recovery: null, state: "ready" };
}

export function visibleConnectorRefreshInterval(): number | false {
  return typeof document === "undefined" || document.visibilityState === "visible" ? 30_000 : false;
}
