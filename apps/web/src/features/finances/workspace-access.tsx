import { type ReactNode, useEffect, useRef } from "react";
import { Link, Navigate, useLocation } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { WorkspaceSkeleton } from "@/components/workspace-skeleton";
import {
  financeRouteNeedsSetup,
  financeSetupTask,
  safeFinanceReturnTo,
} from "./finance-workspace-access";
import { useFinanceWorkspaceReadiness } from "./use-finance-workspace-readiness";

/** Presentation routing only; each underlying task retains canonical server authorization. */
export function FinanceWorkspaceAccess({ children }: { children: ReactNode }) {
  const location = useLocation();
  const state = useFinanceWorkspaceReadiness();
  const notified = useRef<unknown>(null);
  useEffect(() => {
    if (state.isError && state.error !== notified.current) {
      notified.current = state.error;
      toast.error("Finance setup could not be checked. Try again.");
    }
  }, [state.error, state.isError]);
  const needsSetup = financeRouteNeedsSetup(location.pathname, location.search);
  if (!state.snapshot) {
    // Repair routes remain usable when optional access evidence cannot load.
    if (!needsSetup) return children;
    if (state.isPending) return <WorkspaceSkeleton kind="finances" />;
    return (
      <section aria-label="Finance setup" className="grid gap-4">
        <h2>Finance setup</h2>
        {state.isError ? (
          <Button
            onClick={async () => {
              const id = toast.loading("Checking Finance setup…");
              try {
                await state.reload();
                toast.dismiss(id);
              } catch {
                toast.error("Finance setup could not be checked. Try again.", { id });
              }
            }}
          >
            Retry Finance setup
          </Button>
        ) : null}
        <Button asChild variant="secondary">
          <Link to="/finances/setup">Open setup</Link>
        </Button>
        <Button asChild variant="ghost">
          <Link to="/finances/accounts">Manage accounts</Link>
        </Button>
      </section>
    );
  }
  if (!state.readiness?.workspaceAccessible && needsSetup) {
    const returnTo = safeFinanceReturnTo(`${location.pathname}${location.search}${location.hash}`);
    return <Navigate replace to={`/finances/setup?${new URLSearchParams({ returnTo })}`} />;
  }
  const task = financeSetupTask(location.pathname, location.search);
  if (!state.readiness?.workspaceAccessible && task)
    return (
      <div className="grid gap-4">
        <section className="flex flex-wrap items-center gap-3" aria-label="Setup task">
          <span>
            {task === "correct"
              ? "Correct your records"
              : task === "import"
                ? "Import your records"
                : "Review your budget approval"}
          </span>
          <Button asChild variant="secondary">
            <Link to="/finances/setup">Return to setup</Link>
          </Button>
        </section>
        {children}
      </div>
    );
  return children;
}
