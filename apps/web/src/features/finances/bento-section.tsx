import type { ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function FinanceBentoSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="min-w-0">
      <Card className="h-full">
        <CardHeader>
          <CardTitle>
            <h2>{title}</h2>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex min-w-0 flex-col gap-3 [&_[data-slot=item]]:flex-col [&_[data-slot=item]]:items-start [&_[data-slot=item]]:px-0 [&_[data-slot=item-description]]:line-clamp-none">
          {children}
        </CardContent>
      </Card>
    </section>
  );
}
