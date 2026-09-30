import type { ComponentType } from "react";
import { Skeleton } from "@/components/ui/skeleton";

export type WorkspaceSkeletonKind =
  | "calendar"
  | "finances"
  | "generic"
  | "mail"
  | "tasks"
  | "today";

const workspaceLabels: Record<WorkspaceSkeletonKind, string> = {
  calendar: "calendar",
  finances: "finances",
  generic: "content",
  mail: "mail",
  tasks: "tasks",
  today: "Today",
};
const calendarSkeletonDays = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const;
const taskSkeletonRows = ["capture", "plan", "prepare", "follow-up", "review"] as const;
const mailSkeletonRows = ["primary", "updates", "people", "receipts", "travel", "archive"] as const;
const financeSkeletonMetrics = ["spending", "accounts", "review"] as const;
const workspaceSkeletonComponents: Record<WorkspaceSkeletonKind, ComponentType> = {
  calendar: CalendarSkeleton,
  finances: FinancesSkeleton,
  generic: GenericSkeleton,
  mail: MailSkeleton,
  tasks: TasksSkeleton,
  today: TodaySkeleton,
};

export function WorkspaceSkeleton({
  kind,
  mode = "loading",
}: {
  kind: WorkspaceSkeletonKind;
  mode?: "loading" | "preview";
}) {
  const SkeletonContent = workspaceSkeletonComponents[kind];
  return (
    <section
      aria-busy={mode === "loading" ? "true" : undefined}
      aria-label={
        mode === "preview"
          ? `${workspaceLabels[kind]} workspace preview`
          : `Loading ${workspaceLabels[kind]}`
      }
      className={`workspace-skeleton workspace-skeleton--${kind}`}
      data-workspace-skeleton={kind}
      role="status"
    >
      <SkeletonContent />
    </section>
  );
}

function TodaySkeleton() {
  return (
    <div className="workspace-skeleton__today">
      <div className="workspace-skeleton__stack">
        <Skeleton className="workspace-skeleton__line workspace-skeleton__line--short" />
        <Skeleton className="workspace-skeleton__moment" />
        <Skeleton className="workspace-skeleton__line workspace-skeleton__line--medium" />
        <Skeleton className="workspace-skeleton__row" />
        <Skeleton className="workspace-skeleton__row" />
        <Skeleton className="workspace-skeleton__row" />
      </div>
      <div className="workspace-skeleton__stack">
        <Skeleton className="workspace-skeleton__line workspace-skeleton__line--short" />
        <Skeleton className="workspace-skeleton__panel workspace-skeleton__panel--tall" />
        <Skeleton className="workspace-skeleton__panel" />
      </div>
    </div>
  );
}

function CalendarSkeleton() {
  return (
    <div className="workspace-skeleton__calendar">
      <div className="workspace-skeleton__calendar-days">
        {calendarSkeletonDays.map((day, index) => (
          <div className="workspace-skeleton__calendar-day" key={day}>
            <Skeleton className="workspace-skeleton__calendar-label" />
            <Skeleton className="workspace-skeleton__calendar-event" />
            {index === 1 || index === 4 ? (
              <Skeleton className="workspace-skeleton__calendar-event workspace-skeleton__calendar-event--later" />
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

function TasksSkeleton() {
  return (
    <div className="workspace-skeleton__narrow">
      <Skeleton className="workspace-skeleton__line workspace-skeleton__line--short" />
      <Skeleton className="workspace-skeleton__line workspace-skeleton__line--medium" />
      <div className="workspace-skeleton__stack workspace-skeleton__stack--rows">
        {taskSkeletonRows.map((row) => (
          <Skeleton className="workspace-skeleton__row" key={row} />
        ))}
      </div>
    </div>
  );
}

function MailSkeleton() {
  return (
    <div className="workspace-skeleton__mail">
      <div className="workspace-skeleton__mail-list">
        <Skeleton className="workspace-skeleton__line workspace-skeleton__line--medium" />
        {mailSkeletonRows.map((row) => (
          <Skeleton className="workspace-skeleton__mail-row" key={row} />
        ))}
      </div>
      <div className="workspace-skeleton__mail-reader">
        <Skeleton className="workspace-skeleton__line workspace-skeleton__line--short" />
        <Skeleton className="workspace-skeleton__line workspace-skeleton__line--long" />
        <Skeleton className="workspace-skeleton__panel workspace-skeleton__panel--tall" />
      </div>
    </div>
  );
}

function FinancesSkeleton() {
  return (
    <div className="workspace-skeleton__finances">
      <Skeleton className="workspace-skeleton__line workspace-skeleton__line--short" />
      <div className="workspace-skeleton__metrics">
        {financeSkeletonMetrics.map((metric) => (
          <Skeleton className="workspace-skeleton__metric" key={metric} />
        ))}
      </div>
      <div className="workspace-skeleton__finance-panels">
        <Skeleton className="workspace-skeleton__panel workspace-skeleton__panel--tall" />
        <Skeleton className="workspace-skeleton__panel workspace-skeleton__panel--tall" />
      </div>
    </div>
  );
}

function GenericSkeleton() {
  return (
    <div className="workspace-skeleton__narrow">
      <Skeleton className="workspace-skeleton__line workspace-skeleton__line--short" />
      <Skeleton className="workspace-skeleton__line workspace-skeleton__line--medium" />
      <div className="workspace-skeleton__stack workspace-skeleton__stack--rows">
        <Skeleton className="workspace-skeleton__row" />
        <Skeleton className="workspace-skeleton__row" />
        <Skeleton className="workspace-skeleton__row" />
      </div>
    </div>
  );
}
