import { Navigate, useLocation } from "react-router-dom";
import { api } from "../../api.js";
import { FinanceAccountsPage } from "./accounts-page.js";
import { FinanceActivityPage } from "./activity-page.js";
import { FinanceAutomationsPage } from "./automations-page.js";
import { FinanceCashflowPage } from "./cashflow-page.js";
import { FinanceConversationPage } from "./conversation-page.js";
import { FinanceOverviewPage } from "./overview-page.js";
import { FinancesPage } from "./page.js";
import { FinancePeriodReviewPage } from "./period-review-page.js";
import { FinancePlanPage } from "./plan-page.js";
import { FinanceReviewPage } from "./review-page.js";
import { FinanceSetupPage } from "./setup-page.js";
import { FinanceSpendingPage } from "./spending-page";
import { FinanceWealthPage } from "./wealth-page.js";
import { FinanceWorkspaceAccess } from "./workspace-access";

export function FinanceWorkspacePage({ ownerId }: { ownerId: string }) {
  return (
    <FinanceWorkspaceAccess>
      <FinanceWorkspaceRoute ownerId={ownerId} />
    </FinanceWorkspaceAccess>
  );
}

function FinanceWorkspaceRoute({ ownerId }: { ownerId: string }) {
  const location = useLocation();
  const [section, reviewId] = location.pathname.split("/").slice(2);
  switch (section) {
    case "chat":
      return <FinanceConversationPage ownerId={ownerId} />;
    case "automations":
      return <FinanceAutomationsPage />;
    case "activity":
      return <FinanceActivityPage ownerId={ownerId} readActivity={api.listFinanceActivity} />;
    case "spending":
      return <FinanceSpendingPage />;
    case "accounts":
      return <FinanceAccountsPage />;
    case "plan":
      return (
        <FinancePlanPage
          approvalTask={new URLSearchParams(location.search).get("financeTask") === "approve"}
        />
      );
    case "budgets":
      return <Navigate replace to={`/finances/plan${location.search}`} />;
    case "cashflow":
    case "subscriptions":
      return <FinanceCashflowPage />;
    case "review":
      return reviewId === "legacy" ? <FinancesPage /> : <FinanceReviewPage />;
    case "reviews":
      return reviewId ? (
        <FinancePeriodReviewPage id={reviewId} />
      ) : (
        <Navigate replace to="/finances" />
      );
    case "profile":
      return <Navigate replace to="/finances/setup?section=profile" />;
    case "setup":
      return <FinanceSetupPage />;
    case "wealth":
      return <FinanceWealthPage />;
    case "imports":
      return <Navigate replace to="/finances/transactions?import=1" />;
    case "health":
      return <Navigate replace to="/finances/transactions?checks=1" />;
    case "transactions":
      return <FinancesPage key={`${section}:${location.search}`} />;
    case "":
    case undefined:
    case "overview":
      return <FinanceOverviewPage />;
    default:
      return <Navigate replace to="/finances" />;
  }
}
