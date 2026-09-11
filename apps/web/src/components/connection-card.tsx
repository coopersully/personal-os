import type { ReactNode } from "react";

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
    <article className="connection-card" data-slot="item" data-state={state}>
      <header className="connection-card__header">
        <div className="connection-card__identity">
          {identity}
          <div className="connection-card__identity-copy">
            <h3>{title}</h3>
            <p>{subtitle}</p>
          </div>
        </div>
        <div className="connection-card__status">{status}</div>
      </header>
      <div className="connection-card__summary">{summary}</div>
      {capabilities || actions ? (
        <footer className="connection-card__footer">
          <div className="connection-card__capabilities">{capabilities}</div>
          <div className="connection-card__actions">{actions}</div>
        </footer>
      ) : null}
    </article>
  );
}
