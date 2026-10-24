import type { FinanceBudgetApprovalReadiness } from "@personal-os/domain";
import { useMutation } from "@tanstack/react-query";
import { useId } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { ActionButton as Button } from "@/components/action-button";

export function isBudgetApprovalConflict(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      (("status" in error && error.status === 409) ||
        ("code" in error && error.code === "conflict")) &&
      !(
        error instanceof Error &&
        error.message.includes("previously failed; use a new idempotency key")
      ),
  );
}

function approvalErrorMessage(error: unknown): string {
  const status = error && typeof error === "object" && "status" in error ? error.status : null;
  const message = isBudgetApprovalConflict(error)
    ? "The plan or profile changed. Refresh the plan, review its readiness, then approve again. Your local decisions are preserved."
    : status === 401
      ? "Sign in again, then refresh the plan before approving."
      : status === 403
        ? "Approval is not permitted for this account. Check your Finance access before trying again."
        : status === 400
          ? "Review the proposal’s readiness and correct its resources or allocations before approving."
          : "Approval could not be confirmed. Refresh the plan to check whether it is active before retrying. If this continues, share the request ID with support.";
  const requestId =
    error &&
    typeof error === "object" &&
    "requestId" in error &&
    typeof error.requestId === "string"
      ? error.requestId
      : null;
  return `${message}${requestId ? ` Request ID: ${requestId}` : ""}`;
}

/** One toast follows the approval attempt; refresh errors cannot masquerade as failed writes. */
export function useBudgetApproval<TInput, TResult>(options: {
  mutationFn: (input: TInput) => Promise<TResult>;
  onError: (error: Error, input: TInput) => void;
  onSuccess: (result: TResult) => Promise<void>;
  refresh: () => Promise<void>;
}) {
  const toastId = useId();
  return useMutation({
    mutationFn: options.mutationFn,
    retry: false,
    onMutate: () => {
      toast.loading("Approving budget…", { id: toastId });
    },
    onError: (error: Error, input: TInput) => {
      options.onError(error, input);
      toast.error("Approval needs review", {
        id: toastId,
        description: approvalErrorMessage(error),
        duration: Number.POSITIVE_INFINITY,
        action: {
          label: "Refresh plan",
          onClick: () => {
            void options.refresh();
          },
        },
      });
    },
    onSuccess: async (result: TResult) => {
      try {
        await options.onSuccess(result);
        toast.success("Budget approved.", { id: toastId });
      } catch {
        toast.error(
          "Budget approved, but the view could not refresh. Refresh the plan to see its current state.",
          { id: toastId },
        );
      }
    },
  });
}

export function BudgetApprovalReadiness({
  readiness,
  onRevise,
  onRefresh,
  revisionHref,
}: {
  readiness: FinanceBudgetApprovalReadiness | undefined;
  onRevise?: (() => void) | undefined;
  revisionHref: string;
  onRefresh: () => void;
}) {
  return (
    <section aria-label="Budget approval readiness" className="grid gap-2">
      <p className="text-sm text-muted-foreground">
        {readiness?.message ??
          "Approval readiness is unavailable. Refresh the plan before approving."}
      </p>
      {readiness?.recovery === "revise_proposal" && onRevise ? (
        <Button variant="outline" onClick={onRevise}>
          Review proposal
        </Button>
      ) : readiness?.recovery === "revise_proposal" ? (
        <Button asChild variant="outline">
          <Link to={revisionHref}>Review proposal</Link>
        </Button>
      ) : null}
      {!readiness || readiness.recovery === "refresh_plan" ? (
        <Button variant="outline" onClick={onRefresh}>
          Refresh plan
        </Button>
      ) : null}
    </section>
  );
}
