import { Children, type ReactNode } from "react";
import { Link } from "react-router-dom";
import type { Icon } from "@/components/icons";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function KeyMetric({
  label,
  value,
  description,
  exactValue,
  icon: Icon,
  to,
  compact = false,
}: {
  label: string;
  value: ReactNode;
  description?: string;
  exactValue?: string;
  icon?: Icon;
  to?: string;
  compact?: boolean;
}) {
  const card = (
    <Card size={compact ? "sm" : "default"} className="min-w-0 h-full">
      <CardHeader className={compact ? "pb-1" : undefined}>
        <CardTitle className="flex items-center gap-2">
          {Icon ? <Icon aria-hidden="true" className={compact ? "size-4" : undefined} /> : null}
          {label}
        </CardTitle>
        {description && !compact ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>
      <CardContent className={compact ? undefined : "mt-auto"}>
        <p
          title={exactValue}
          className={`break-words font-semibold tabular-nums ${compact ? "text-2xl" : "text-3xl"}`}
        >
          <span aria-hidden={exactValue && exactValue !== value ? true : undefined}>{value}</span>
          {exactValue && exactValue !== value ? (
            <span className="sr-only">{exactValue}</span>
          ) : null}
        </p>
        {description && compact ? (
          <CardDescription className="mt-1 text-xs">{description}</CardDescription>
        ) : null}
      </CardContent>
    </Card>
  );
  return to ? (
    <Link
      to={to}
      className="block min-w-0 h-full rounded-xl outline-none transition-colors hover:bg-secondary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground/50 [&:hover>[data-slot=card]]:bg-secondary"
    >
      {card}
    </Link>
  ) : (
    card
  );
}

/** Fit metrics side by side when space permits; wrap without hiding any metric. */
export function KeyMetrics({
  children,
  label = "Key metrics",
}: {
  children: ReactNode;
  label?: string;
}) {
  return (
    <section aria-label={label} className="@container min-w-0">
      <div
        className={
          Children.count(children) === 4
            ? "grid min-w-0 grid-cols-2 gap-4 @min-[56rem]:grid-cols-4"
            : "grid min-w-0 gap-4 [grid-template-columns:repeat(auto-fit,minmax(min(100%,13rem),1fr))]"
        }
      >
        {children}
      </div>
    </section>
  );
}
