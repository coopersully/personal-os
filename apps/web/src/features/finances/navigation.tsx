import type { LucideIcon } from "lucide-react";
import {
  BadgeDollarSign,
  Landmark,
  ReceiptText,
  ShieldCheck,
  SlidersHorizontal,
  WalletCards,
} from "lucide-react";
import { Link } from "react-router-dom";

export type FinanceSection =
  | "accounts"
  | "budgets"
  | "cashflow"
  | "health"
  | "imports"
  | "overview"
  | "profile"
  | "review"
  | "subscriptions"
  | "transactions";

const navigation: Array<{
  items: Array<{ icon: LucideIcon; id: FinanceSection; label: string }>;
  label: string;
}> = [
  {
    items: [
      { icon: Landmark, id: "overview", label: "Overview" },
      { icon: BadgeDollarSign, id: "cashflow", label: "Cash flow" },
      { icon: ReceiptText, id: "transactions", label: "Transactions" },
      { icon: WalletCards, id: "budgets", label: "Budgets" },
      { icon: ReceiptText, id: "subscriptions", label: "Subscriptions" },
      { icon: ShieldCheck, id: "health", label: "Ledger health" },
      { icon: SlidersHorizontal, id: "profile", label: "Financial profile" },
    ],
    label: "Finances",
  },
];

export function financeSectionFromPath(pathname: string): FinanceSection {
  const section = pathname.split("/")[2];
  return (
    [
      "accounts",
      "budgets",
      "cashflow",
      "health",
      "imports",
      "overview",
      "profile",
      "review",
      "subscriptions",
      "transactions",
    ] as const
  ).some((item) => item === section)
    ? (section as FinanceSection)
    : "overview";
}

export function FinanceSidebarNavigation({
  onNavigate,
  reviewCount,
  section,
}: {
  onNavigate: () => void;
  reviewCount: number;
  section: FinanceSection;
}) {
  return navigation.map((group) => (
    <nav aria-label={group.label} className="sidebar-group" key={group.label}>
      <p className="sidebar-group__label">{group.label}</p>
      <div className="nav-list">
        {group.items.map(({ icon: Icon, id, label }) => (
          <Link
            aria-current={section === id ? "page" : undefined}
            className={`nav-item${section === id ? " nav-item--active" : ""}`}
            key={id}
            onClick={onNavigate}
            to={id === "overview" ? "/finances" : `/finances/${id}`}
          >
            <Icon aria-hidden="true" size={19} />
            <span>{label}</span>
            {id === "review" && reviewCount > 0 ? <b>{reviewCount}</b> : null}
          </Link>
        ))}
      </div>
    </nav>
  ));
}
