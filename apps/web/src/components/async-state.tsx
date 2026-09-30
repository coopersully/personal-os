import { ApiClientError } from "@personal-os/api-client";
import { Spinner } from "@personal-os/ui";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "./ui/alert.js";
import { Button } from "./ui/button.js";

export function PageLoading() {
  return (
    <div className="page-loading">
      <Spinner label="Loading" />
    </div>
  );
}

export function InlineError({
  error,
  title = "Couldn’t load this material.",
  retry,
  stale = false,
}: {
  error: unknown;
  title?: string;
  retry?: () => unknown;
  stale?: boolean;
}) {
  const description =
    error instanceof ApiClientError && error.status === 401
      ? "Your session has expired. Sign in again to continue."
      : error instanceof ApiClientError && error.status === 403
        ? "You don’t have access to this material. Check the account’s permissions."
        : stale
          ? "Showing the last available update. Try refreshing before relying on this information."
          : "Try again. If the problem continues, check your connection.";
  return (
    <Alert variant={stale ? "warning" : "destructive"} role="status">
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>{description}</AlertDescription>
      {retry ? (
        <AlertAction>
          <Button
            onClick={() => {
              void retry();
            }}
            variant="outline"
            size="sm"
          >
            Try again
          </Button>
        </AlertAction>
      ) : null}
    </Alert>
  );
}

export function QueryFeedback({
  query,
  title,
  staleOnly = false,
}: {
  query: { isError: boolean; error: unknown; data?: unknown; refetch?: () => unknown };
  title: string;
  staleOnly?: boolean;
}) {
  if (!query.isError || (staleOnly && query.data === undefined)) return null;
  return (
    <InlineError
      error={query.error}
      title={title}
      stale={query.data !== undefined}
      {...(query.refetch ? { retry: query.refetch } : {})}
    />
  );
}
