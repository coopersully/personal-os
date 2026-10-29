import type { ReactNode } from "react";
import { Item } from "@/components/ui/item";
import { SettingsIconSlot } from "./settings-icon-slot";

export function ConnectionCard({
  actions,
  capabilities,
  identity,
  state,
  status,
  subtitle,
  summary,
  title,
}: {
  actions?: ReactNode;
  capabilities?: ReactNode;
  identity: ReactNode;
  state: "ready" | "reconnect" | "retrying" | "service_attention" | "syncing";
  status: ReactNode;
  subtitle: ReactNode;
  summary: ReactNode;
  title: ReactNode;
}) {
  return (
    <Item variant="secondary" className="settings-record block p-0" asChild>
      <article data-state={state}>
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2">
          <SettingsIconSlot>{identity}</SettingsIconSlot>
          <span className="min-w-0 flex-1 text-sm font-medium">{title}</span>
          <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-3 text-sm text-muted-foreground">
            <span className="break-all">{subtitle}</span>
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
