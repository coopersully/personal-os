import type { FinanceCapabilityReadiness } from "@personal-os/domain";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
export function FinancePrerequisiteScreen({
  title,
  readiness,
  returnTo,
  retry,
}: {
  title: string;
  readiness: FinanceCapabilityReadiness;
  returnTo: string;
  retry?: () => void;
}) {
  const safeReturn = /^\/finances(?:[/?#]|$)/.test(returnTo) ? returnTo : "/finances";
  const href = readiness.href
    ? `${readiness.href}${readiness.href.includes("?") ? "&" : "?"}returnTo=${encodeURIComponent(safeReturn)}`
    : null;
  return (
    <Empty>
      <EmptyHeader>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{readiness.reason}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        {href ? (
          <Button asChild>
            <Link to={href}>{readiness.action}</Link>
          </Button>
        ) : retry ? (
          <Button variant="secondary" onClick={retry}>
            Retry
          </Button>
        ) : null}
      </EmptyContent>
    </Empty>
  );
}
