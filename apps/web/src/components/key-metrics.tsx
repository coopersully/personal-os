import { Children, type ReactNode } from "react";
import type { Icon } from "@/components/icons";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function KeyMetric({
  label,
  value,
  description,
  exactValue,
  icon: Icon,
}: {
  label: string;
  value: ReactNode;
  description?: string;
  exactValue?: string;
  icon?: Icon;
}) {
  return (
    <Card className="min-w-0 h-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {Icon ? <Icon aria-hidden="true" /> : null}
          {label}
        </CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>
      <CardContent className="mt-auto">
        <p title={exactValue} className="break-words text-3xl font-semibold tabular-nums">
          <span aria-hidden={exactValue && exactValue !== value ? true : undefined}>{value}</span>
          {exactValue && exactValue !== value ? (
            <span className="sr-only">{exactValue}</span>
          ) : null}
        </p>
      </CardContent>
    </Card>
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
