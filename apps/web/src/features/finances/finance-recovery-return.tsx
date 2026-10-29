import { Link, useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { financeConversationReturnTo } from "./automation-recovery.js";

/** Recovery destinations may return only to the existing Finance conversation. */
export function FinanceRecoveryReturn() {
  const location = useLocation();
  const returnTo = financeConversationReturnTo(
    new URLSearchParams(location.search).get("returnTo"),
  );
  return returnTo ? (
    <Button asChild variant="secondary" className="self-start">
      <Link to={returnTo}>Return to conversation</Link>
    </Button>
  ) : null;
}
