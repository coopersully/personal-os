import { Link } from "react-router-dom";
import {
  BankIcon,
  DollarIcon,
  type Icon,
  ReceiptIcon,
  ShieldCheckIcon,
  SliderHorizontalIcon,
  WalletIcon,
} from "@/components/icons";

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
  items: Array<{ icon: Icon; id: FinanceSection; label: string }>;
  label: string;
}> = [
  {
    items: [
      { icon: BankIcon, id: "overview", label: "Overview" },
      { icon: DollarIcon, id: "cashflow", label: "Cash flow" },
      { icon: ReceiptIcon, id: "transactions", label: "Transactions" },
      { icon: WalletIcon, id: "budgets", label: "Budgets" },
      { icon: ReceiptIcon, id: "subscriptions", label: "Subscriptions" },
      { icon: ShieldCheckIcon, id: "health", label: "Ledger health" },
      { icon: SliderHorizontalIcon, id: "profile", label: "Financial profile" },
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
            <Icon aria-hidden="true" className="size-[19px]" />
            <span>{label}</span>
            {id === "review" && reviewCount > 0 ? <b>{reviewCount}</b> : null}
          </Link>
        ))}
      </div>
    </nav>
  ));
}
