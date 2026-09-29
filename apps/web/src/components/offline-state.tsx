import { ErrorPage } from "@/components/error-page";

export function OfflineState({
  development = import.meta.env.DEV,
  onRetry = () => window.location.reload(),
}: {
  development?: boolean;
  onRetry?: () => void;
}) {
  return (
    <ErrorPage
      kind="offline"
      description={development ? "Start the local environment, then try again." : undefined}
      onRetry={onRetry}
    />
  );
}
