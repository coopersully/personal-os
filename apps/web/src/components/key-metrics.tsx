import type { ReactNode } from "react";
import type { Icon } from "@/components/icons";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function KeyMetric({
  label,
  value,
  description,
  icon: Icon,
}: {
  label: string;
  value: ReactNode;
  description?: string;
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
        <p className="break-words text-3xl font-semibold tabular-nums">{value}</p>
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
    <section
      aria-label={label}
      className="grid min-w-0 gap-4 [grid-template-columns:repeat(auto-fit,minmax(min(100%,13rem),1fr))]"
    >
      {children}
    </section>
  );
}
