import { useReducedMotion } from "motion/react";
import { Children, type ReactNode } from "react";
import { Link } from "react-router-dom";
import type { Icon } from "@/components/icons";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from "@/components/ui/carousel";

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

/** A single metric rail; loop when overflowing and hide navigation when everything fits. */
export function KeyMetrics({
  children,
  label = "Key metrics",
}: {
  children: ReactNode;
  label?: string;
}) {
  const reducedMotion = useReducedMotion();
  return (
    <Carousel
      aria-label={label}
      className={`group min-w-0 ${Children.count(children) > 1 ? "pb-9" : ""} ${Children.count(children) <= 3 ? "xl:pb-0" : ""}`}
      opts={{ align: "start", loop: true, duration: reducedMotion ? 0 : 25 }}
    >
      <CarouselContent>
        {Children.map(children, (child) => (
          <CarouselItem className="basis-[85%] sm:basis-1/2 xl:basis-1/3">{child}</CarouselItem>
        ))}
      </CarouselContent>
      <CarouselPrevious className="inset-y-auto bottom-0 left-auto right-10 my-0 opacity-100 transition-opacity sm:opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 disabled:hidden [@media(hover:none)]:opacity-100" />
      <CarouselNext className="inset-y-auto bottom-0 right-0 my-0 opacity-100 transition-opacity sm:opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 disabled:hidden [@media(hover:none)]:opacity-100" />
    </Carousel>
  );
}
