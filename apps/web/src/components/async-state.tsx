import { ApiClientError } from "@personal-os/api-client";
import { useContext, useEffect, useId, useRef } from "react";
import { toast } from "sonner";
import { useSettingsError } from "../lib/settings-feedback.js";
import { ReadFailureContext } from "./read-failure-boundary";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "./ui/alert.js";
import { Button } from "./ui/button.js";
import { WorkspaceSkeleton, type WorkspaceSkeletonKind } from "./workspace-skeleton.js";

export function PageLoading({ workspace = "generic" }: { workspace?: WorkspaceSkeletonKind }) {
  return <WorkspaceSkeleton kind={workspace} />;
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
  const settingsFeedback = useSettingsError(error, title, retry);
  if (settingsFeedback) return null;
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

export function useQueryFeedback({
  query,
  title,
  staleOnly = false,
}: {
  query: { isError: boolean; error: unknown; data?: unknown; refetch?: () => unknown };
  title: string;
  staleOnly?: boolean;
}) {
  const blocked = useContext(ReadFailureContext);
  const id = useId();
  const previous = useRef(false);
  const retry = useRef(query.refetch);
  retry.current = query.refetch;
  const failed = !blocked && query.isError && (!staleOnly || query.data !== undefined);
  useEffect(() => {
    if (failed && !previous.current) {
      toast.error(title, {
        id,
        duration: Number.POSITIVE_INFINITY,
        description:
          query.data !== undefined
            ? "Showing the last available update."
            : "Try again in a moment.",
        ...(retry.current
          ? {
              action: {
                label: "Try again",
                onClick: () => {
                  toast.promise(
                    Promise.resolve(retry.current?.()).then((result) => {
                      if (
                        result &&
                        typeof result === "object" &&
                        "isError" in result &&
                        result.isError
                      )
                        throw new Error("Read unavailable");
                    }),
                    {
                      id,
                      loading: "Refreshing…",
                      success: "Refreshed.",
                      error: { message: title, duration: Number.POSITIVE_INFINITY },
                    },
                  );
                },
              },
            }
          : {}),
      });
    }
    if (!failed && previous.current) toast.dismiss(id);
    previous.current = failed;
  }, [failed, id, title, query.data]);
  useEffect(
    () => () => {
      toast.dismiss(id);
    },
    [id],
  );
  return null;
}

/** Feedback is an effect, never a layout item. */
export function QueryFeedback(props: Parameters<typeof useQueryFeedback>[0]) {
  useQueryFeedback(props);
  return null;
}
