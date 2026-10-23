import { ApiClientError } from "@personal-os/api-client";
import { useErrorToast, useSettingsError } from "../lib/settings-feedback.js";
import { Button } from "./ui/button.js";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "./ui/empty.js";
import { WorkspaceSkeleton, type WorkspaceSkeletonKind } from "./workspace-skeleton.js";

export function PageLoading({ workspace = "generic" }: { workspace?: WorkspaceSkeletonKind }) {
  return <WorkspaceSkeleton kind={workspace} />;
}

export function InlineError({
  error,
  title = "Couldn’t load this material.",
  retry,
  stale = false,
  toastOnly = false,
}: {
  error: unknown;
  title?: string;
  retry?: () => unknown;
  stale?: boolean;
  toastOnly?: boolean;
}) {
  const settingsFeedback = useSettingsError(error, title, retry);
  useErrorToast(error, title, retry, !settingsFeedback);
  if (settingsFeedback || stale || toastOnly) return null;
  const description =
    error instanceof ApiClientError && error.status === 401
      ? "Your session has expired. Sign in again to continue."
      : error instanceof ApiClientError && error.status === 403
        ? "You don’t have access to this material. Check the account’s permissions."
        : "Try again. If the problem continues, check your connection.";
  return (
    <Empty role="region" aria-label={title}>
      <EmptyHeader>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
      {retry ? (
        <EmptyContent>
          <Button
            onClick={() => {
              void retry();
            }}
            variant="secondary"
            size="sm"
          >
            Try again
          </Button>
        </EmptyContent>
      ) : null}
    </Empty>
  );
}

export function QueryFeedback({
  query,
  title,
  staleOnly = false,
  toastOnly = false,
}: {
  query: { isError: boolean; error: unknown; data?: unknown; refetch?: () => unknown };
  title: string;
  staleOnly?: boolean;
  toastOnly?: boolean;
}) {
  if (!query.isError || (staleOnly && query.data === undefined)) return null;
  return (
    <InlineError
      error={query.error}
      title={title}
      toastOnly={toastOnly}
      stale={query.data !== undefined}
      {...(query.refetch ? { retry: query.refetch } : {})}
    />
  );
}
