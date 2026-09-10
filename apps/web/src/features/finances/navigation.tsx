import { Link } from "react-router-dom";
import {
  BankIcon,
  DollarIcon,
  GridIcon,
  type Icon,
  ListChecksIcon,
  ReceiptIcon,
  SettingsIcon,
  ShieldCheckIcon,
  TargetIcon,
  WalletIcon,
} from "@/components/icons";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";

export type FinanceSection =
  | "accounts"
  | "budgets"
  | "cashflow"
  | "health"
  | "imports"
  | "overview"
  | "plan"
  | "wealth"
  | "setup"
  | "review"
  | "subscriptions"
  | "transactions";

const navigation: Array<{
  items: Array<{ icon: Icon; id: FinanceSection; label: string }>;
  label: string;
}> = [
  {
    items: [
      { icon: GridIcon, id: "overview", label: "Overview" },
      { icon: ListChecksIcon, id: "review", label: "Review" },
      { icon: ReceiptIcon, id: "transactions", label: "Transactions" },
      { icon: WalletIcon, id: "plan", label: "Plan" },
      { icon: DollarIcon, id: "cashflow", label: "Cash flow" },
      { icon: TargetIcon, id: "wealth", label: "Wealth" },
      { icon: BankIcon, id: "accounts", label: "Accounts" },
    ],
    label: "Finances",
  },
];

export function financeSectionFromPath(pathname: string): FinanceSection {
  const section = pathname.split("/")[2];
  if (section === "budgets") return "plan";
  if (section === "reviews") return "overview";
  return (
    [
      "accounts",
      "budgets",
      "cashflow",
      "health",
      "imports",
      "overview",
      "plan",
      "wealth",
      "setup",
      "review",
      "subscriptions",
      "transactions",
    ] as const
  ).some((item) => item === section)
    ? (section as FinanceSection)
    : "overview";
}

function financeNavigationActive(section: FinanceSection, destination: FinanceSection) {
  return (
    section === destination ||
    (destination === "cashflow" && section === "subscriptions") ||
    (destination === "accounts" && (section === "imports" || section === "health"))
  );
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
    <SidebarGroup key={group.label}>
      <SidebarGroupContent>
        <nav aria-label={group.label}>
          <SidebarMenu>
            {group.items.map(({ icon: Icon, id, label }) => (
              <SidebarMenuItem key={id}>
                <SidebarMenuButton asChild isActive={financeNavigationActive(section, id)}>
                  <Link
                    aria-current={financeNavigationActive(section, id) ? "page" : undefined}
                    aria-label={
                      id === "review" && reviewCount > 0 ? `${label} ${reviewCount}` : label
                    }
                    onClick={onNavigate}
                    to={id === "overview" ? "/finances" : `/finances/${id}`}
                  >
                    <Icon
                      aria-hidden="true"
                      weight={financeNavigationActive(section, id) ? "Filled" : "Outline"}
                    />
                    <span>{label}</span>
                  </Link>
                </SidebarMenuButton>
                {id === "review" && reviewCount > 0 ? (
                  <SidebarMenuBadge aria-hidden="true">{reviewCount}</SidebarMenuBadge>
                ) : null}
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </nav>
        <SidebarMenu className="mt-6">
          <SidebarMenuItem>
            <SidebarMenuButton asChild isActive={section === "setup"}>
              <Link
                aria-current={section === "setup" ? "page" : undefined}
                onClick={onNavigate}
                to="/finances/setup"
              >
                <ShieldCheckIcon /> <span>Financial setup</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton asChild>
              <Link onClick={onNavigate} to="/settings?section=finances">
                <SettingsIcon /> <span>Finance settings</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  ));
}
