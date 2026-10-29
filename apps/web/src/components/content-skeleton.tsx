import { Skeleton } from "@/components/ui/skeleton";

/** Match the owning region's geometry. No timers, requests, or fake progress. */
export function ContentSkeleton({
  label,
  shape = "list",
  rows = 3,
  announce = true,
}: {
  label: string;
  shape?: "list" | "summary" | "settings";
  rows?: number;
  announce?: boolean;
}) {
  return (
    <div
      {...(announce
        ? { role: "status", "aria-label": label, "aria-busy": true }
        : { "aria-hidden": true })}
      className="content-skeleton"
      data-shape={shape}
    >
      {announce ? <span className="sr-only">{label}</span> : null}
      <div aria-hidden="true" className="content-skeleton__items">
        {["first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth"]
          .slice(0, Math.max(1, rows))
          .map((row) => (
            <div className="content-skeleton__item" key={row}>
              <Skeleton className="content-skeleton__icon" />
              <div className="content-skeleton__text">
                <Skeleton className="content-skeleton__title" />
                <Skeleton className="content-skeleton__detail" />
              </div>
            </div>
          ))}
      </div>
    </div>
  );
}
