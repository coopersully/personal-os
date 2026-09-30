import { Navigate, useLocation } from "react-router-dom";
import { FinanceAccountsPage } from "./accounts-page.js";
import { FinanceCashflowPage } from "./cashflow-page.js";
import { FinanceOverviewPage } from "./overview-page.js";
import { FinancesPage } from "./page.js";
import { FinancePeriodReviewPage } from "./period-review-page.js";
import { FinancePlanPage } from "./plan-page.js";
import { FinanceReviewPage } from "./review-page.js";
import { FinanceSetupPage } from "./setup-page.js";
import { FinanceWealthPage } from "./wealth-page.js";

export function FinanceWorkspacePage() {
  const location = useLocation();
  const [section, reviewId] = location.pathname.split("/").slice(2);
  switch (section) {
    case "accounts":
      return <FinanceAccountsPage />;
    case "plan":
      return <FinancePlanPage />;
    case "budgets":
      return <Navigate replace to="/finances/plan" />;
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
    case "setup":
      return <FinanceSetupPage />;
    case "wealth":
      return <FinanceWealthPage />;
    case "transactions":
    case "imports":
    case "health":
      return <FinancesPage key={`${section}:${location.search}`} />;
    case "":
    case undefined:
    case "overview":
      return <FinanceOverviewPage />;
    default:
      return <Navigate replace to="/finances" />;
  }
}
