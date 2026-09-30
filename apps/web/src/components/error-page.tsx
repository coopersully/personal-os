import type { ReactNode } from "react";
import { BrandPattern } from "@/components/brand-pattern";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";

export const errorPageStates = {
  "404": {
    label: "404 · Not found",
    title: "Page not found",
    description: "The link may have changed, or the page may no longer exist.",
    retry: false,
  },
  "403": {
    label: "403 · Access denied",
    title: "Access denied",
    description: "Your account doesn’t have access. Check that you’re using the right account.",
    retry: false,
  },
  "500": {
    label: "500 · Server error",
    title: "Server error",
    description: "We couldn’t load this page. Try again in a moment.",
    retry: true,
  },
  "503": {
    label: "503 · Service unavailable",
    title: "Back soon",
    description: "The service is temporarily unavailable. Please try again in a moment.",
    retry: true,
  },
  offline: {
    label: "Connection unavailable",
    title: "Can’t connect",
    description:
      "Check your connection, then try again. The service may also be temporarily unavailable.",
    retry: true,
  },
} as const;

export type ErrorPageKind = keyof typeof errorPageStates;

export function ErrorPage({
  kind = "500",
  description,
  actions,
  onRetry = () => window.location.reload(),
}: {
  kind?: ErrorPageKind;
  description?: string | undefined;
  /** Optional action slot; omitted uses the recovery actions for this error. */
  actions?: ReactNode;
  onRetry?: () => void;
}) {
  const state = errorPageStates[kind];
  return (
    <main className="error-page">
      <BrandPattern fullScreen />
      <Empty className="error-page__content">
        <EmptyHeader className="error-page__header">
          <p className="error-page__code">{state.label}</p>
          <EmptyTitle aria-level={1} className="error-page__title" role="heading">
            {state.title}
          </EmptyTitle>
          <EmptyDescription className="error-page__description" role="alert">
            {description ?? state.description}
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent className="error-page__actions">
          {actions ?? (
            <>
              {state.retry ? <Button onClick={onRetry}>Try again</Button> : null}
              <Button asChild variant={state.retry ? "secondary" : "default"}>
                <a href="/today">Back to Today</a>
              </Button>
            </>
          )}
        </EmptyContent>
      </Empty>
    </main>
  );
}
