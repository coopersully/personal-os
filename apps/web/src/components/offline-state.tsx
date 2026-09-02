import { NohmiBrandMark } from "@/components/brand-marks";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";

export function OfflineState({
  development = import.meta.env.DEV,
  onRetry = () => window.location.reload(),
}: {
  development?: boolean;
  onRetry?: () => void;
}) {
  return (
    <main className="offline-page">
      <Empty className="offline-state">
        <EmptyHeader>
          <EmptyMedia aria-label="nohmi" className="offline-state__brand" role="img">
            <NohmiBrandMark />
          </EmptyMedia>
          <p className="offline-state__status">Service unavailable</p>
          <EmptyTitle aria-level={1} className="offline-state__title" role="heading">
            We can’t reach nohmi right now.
          </EmptyTitle>
          <EmptyDescription className="offline-state__description" role="alert">
            {development
              ? "Start the local environment, then try again."
              : "This is usually temporary. Try again in a moment."}
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button onClick={onRetry} size="lg">
            Try again
          </Button>
        </EmptyContent>
      </Empty>
    </main>
  );
}
