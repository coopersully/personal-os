import type { ReactNode } from "react";
import { SettingsFeedbackContext } from "@/lib/settings-feedback";
import { QueryFeedback } from "./async-state";
import { ContentSkeleton } from "./content-skeleton";
import { CircleAlertIcon, type Icon, InboxIcon } from "./icons";
import { Button } from "./ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "./ui/empty";

/** Domain copy explains the scope; actions change only the view, never its records. */
export function DataViewEmpty({
  title,
  icon: IconComponent = InboxIcon,
  description,
  children,
}: {
  title: string;
  icon?: Icon;
  description?: string;
  children?: ReactNode;
}) {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <IconComponent aria-hidden="true" />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        {description ? <EmptyDescription>{description}</EmptyDescription> : null}
      </EmptyHeader>
      {children ? <EmptyContent>{children}</EmptyContent> : null}
    </Empty>
  );
}

export function DataViewLoading({ label }: { label: string }) {
  return <ContentSkeleton label={label} />;
}

/** Availability/recovery stays discoverable; the error itself has one Sonner owner. */
export function DataViewRecovery({
  query,
  title,
  unavailableLabel,
}: {
  query: {
    isError: boolean;
    error: unknown;
    data?: unknown;
    isFetching: boolean;
    refetch: () => unknown;
  };
  title: string;
  unavailableLabel: string;
}) {
  const retained = query.data !== undefined;
  return (
    <>
      <SettingsFeedbackContext.Provider value={true}>
        <QueryFeedback query={query} title={title} />
      </SettingsFeedbackContext.Provider>
      {query.isError && !retained ? (
        <section
          aria-label={unavailableLabel}
          className="flex flex-col items-center gap-4 py-8 text-center"
        >
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <CircleAlertIcon className="size-4 shrink-0" aria-hidden="true" />
            <span>{unavailableLabel}</span>
          </div>
          <Button
            variant="default"
            disabled={query.isFetching}
            onClick={() => {
              void query.refetch();
            }}
          >
            {query.isFetching ? "Retrying…" : "Try again"}
          </Button>
        </section>
      ) : null}
    </>
  );
}
