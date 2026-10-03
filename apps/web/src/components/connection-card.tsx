import type { ReactNode } from "react";
import { SettingsRecordContent } from "@/components/settings-record";
import { Item } from "@/components/ui/item";

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
    <Item variant="secondary" className="settings-record" asChild>
      <article data-state={state}>
        <SettingsRecordContent
          title={title}
          leading={identity}
          description={subtitle}
          actions={actions}
          metadata={
            <>
              {status}
              {capabilities}
            </>
          }
        >
          <div className="flex min-w-0 flex-col gap-1 text-sm text-muted-foreground">{summary}</div>
        </SettingsRecordContent>
      </article>
    </Item>
  );
}
