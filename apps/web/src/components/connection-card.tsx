import type { ReactNode } from "react";
import { Item } from "@/components/ui/item";
import { ConnectedAccount, type ConnectedAccountProfile } from "./connected-account";

export function ConnectionCard({
  actions,
  capabilities,
  account,
  state,
  status,
  summary,
}: {
  actions?: ReactNode;
  capabilities?: ReactNode;
  account: ConnectedAccountProfile;
  state: "ready" | "reconnect" | "retrying" | "service_attention" | "syncing";
  status: ReactNode;
  summary: ReactNode;
}) {
  return (
    <Item variant="secondary" className="settings-record block p-0" asChild>
      <article data-state={state}>
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2">
          <div className="connection-card__profile">
            <ConnectedAccount account={account} />
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-3 text-sm text-muted-foreground">
            {status}
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/40 px-4 py-3">
          <div className="flex flex-wrap items-center gap-3">{capabilities}</div>
          <div className="ml-auto flex items-center gap-1">{actions}</div>
        </div>
        {state !== "ready" ? (
          <div className="flex min-w-0 flex-col gap-1 border-t border-border/40 px-4 py-3 text-sm text-muted-foreground">
            {summary}
          </div>
        ) : null}
      </article>
    </Item>
  );
}
