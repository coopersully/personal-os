import type { ReactNode } from "react";

/** Shared open section heading; content supplies its own surface when needed. */
export function FinanceSection({
  title,
  label = title,
  children,
  action,
  description,
}: {
  title: string;
  label?: string;
  children: ReactNode;
  action?: ReactNode;
  description?: ReactNode;
}) {
  return (
    <section aria-label={label} className="flex min-w-0 flex-col gap-3 px-1">
      <header className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-medium text-muted-foreground">{title}</h2>
          {action}
        </div>
        {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
      </header>
      {children}
    </section>
  );
}
