import type * as React from "react";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function QuoteCard({
  author,
  className,
  label,
  source,
  text,
  ...props
}: React.ComponentProps<typeof Card> & {
  author?: string;
  label: string;
  source?: string;
  text: string;
}) {
  return (
    <Card aria-label={label} className={cn("quote-card", className)} size="sm" {...props}>
      <CardHeader>
        <CardDescription>{label}</CardDescription>
      </CardHeader>
      <CardContent>
        <figure>
          <blockquote>{text}</blockquote>
          {author || source ? (
            <figcaption>
              {author ? <span>{author}</span> : null}
              {author && source ? <span aria-hidden="true"> · </span> : null}
              {source ? <cite>{source}</cite> : null}
            </figcaption>
          ) : null}
        </figure>
      </CardContent>
    </Card>
  );
}
